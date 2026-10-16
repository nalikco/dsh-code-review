# DSH Code Review

[English](README.md) | Русский

Команда `/code-review` для [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): корректность/безопасность, переиспользование/качество и эффективность. По умолчанию без изменений исходных файлов. Три параллельных reviewer и независимая проверка находок.

Версия **1.0.0**, [MIT](LICENSE).

## Установка

Требуются Node.js22+, локальный Git и DSH со штатными сервисами commands/agents/tools/systemPrompt/fs/sandboxPolicy. Проверены SDK пакеты **0.2.0-rc.2**, Cordis `~4.0.4`, Schemastery `~3.18.4`; другие версии не гарантированы. Linux/Docker проверен локально, macOS включён в CI; Windows/remote fs не заявлены.

В DSH открой **Plugins**, установку bundle и укажи:

```text
https://github.com/nalikco/dsh-code-review.git
```

Для воспроизводимой установки укажи проверенный commit в формате `https://github.com/nalikco/dsh-code-review.git#<commit-sha>`. Также поддерживается установка абсолютного пути клона через Plugin Manager. Проверяй результат установки: `restart-required` требует перезапуска. Не регистрируй другую глобальную команду `code-review` одновременно.

Пакет не требует build/install scripts. `private: true` защищает от случайного npm publish и не мешает Git/local установке. Установка profile-wide влияет на все сессии и запускает host-код с правами пользователя ОС. Live-профиль автоматически не меняется от клонирования репозитория.

## Использование

```text
/code-review
/code-review --focus "обработка таймаутов"
/code-review --base main
/code-review --fix
/code-review --help
```

* Default: staged и unstaged diff отдельно плюс untracked. Обратный unstaged diff не скрывает staged ошибку. Поддерживаются unborn/orphan ветки.
* `--base ref`: staged часть от merge-base ref/HEAD, затем unstaged diff. Untracked включены.
* `--focus`: тема review, не разрешение расширять права. Значения из нескольких слов в кавычках.
* Находки имеют координаты `worktree`, `index` или `base`. Ошибки отдельно от улучшений, malformed finding не уничтожает соседние находки, high не вытесняется low.
* Модель/reasoning наследуются из последнего запроса сессии. Нужен свободный родительский агент и локальный host-backed Git workspace.

Плагин собирает bounded diff, snapshots версий и scoped AGENTS.md/CLAUDE.md внутри repo. Reviewer могут читать дополнительный контекст только read/glob/grep, без shell/MCP/делегирования/записей. После независимой валидации повторно проверяются diff/HEAD/files/versions/instructions. При изменениях отчёт предварительный, статус error, fix не передаётся.

## Как работает `--fix`

После review подтверждённые замены передаются в **обычный ход родителя**. Он читает файлы и использует штатный `edit` с сохранением Auto review, pre-execute/guards, observation и downstream freshness policy. **Успех команды означает queued, не завершение правок.** Результаты остаются в стандартном журнале tools даже при отмене. После хода повтори `/code-review` и отдельно запусти тесты проекта.

Передача запрещена в plan mode/read-only/PTC-only. Нужен штатный `edit` в native/both presentation. На время fix разрешены только reads и exact validated edits, без shell/делегирования/escalation/публикаций. Любая ошибка инструмента останавливает дальнейшие правки. Отмена/выгрузка плагина отменяет fix и не удаляет чужую очередь.

Только существующие changed worktree files. Без create/delete, cross-file fixes и изменения AGENTS.md/CLAUDE.md. Находки index/base только показываются. Auto вправе отказать, поскольку машинное followup не выдаётся за новую human-authority.

**Не редактируй worktree параллельно с `--fix`.** SDK guard не является атомарным CAS относительно внешнего редактора; окно между version probe и rename остаётся. Межфайловой транзакции/автоматического rollback нет. LLM не гарантирует корректность исправления.

## Данные и границы

Diff, исходники, инструкции и прочитанный контекст отправляются настроенному LLM-провайдеру и могут сохраняться в DSH session/spill. Не проверяй секреты или закрытый код без соответствующего разрешения. У плагина нет своего telemetry endpoint/провайдера. Подробности: [SECURITY.md](SECURITY.md).

Git выполняется host-side без shell, GIT_* overrides очищаются, hooks/fsmonitor off, submodules short/nonrecursive, clean/process filters и partial clone отклоняются. Git config, бинарник и host-плагины доверенные. Враждебные same-user процессы вне модели защиты.

PR, comments, commit/push, auto test/typecheck/lint не реализованы. Review read-only относится к исходникам, не к служебным логам DSH. Дополнительные инструкции вне repo зависят от preset. Command report вне model history; --fix явно доставляет предложения родителю.

## Настройки

```yaml
- insert:
    - id: code-review
      name: dsh-code-review
      config:
        maxFiles: 80
        maxDiffBytes: 500000
        maxFileBytes: 250000
        maxFindings: 18
        maxValidations: 12
        timeoutMs: 600000
```

Положительные целые до четырёх default значений. Параллелизм3. Цена: 3 reviewers +до12 validators, с --fix ещё обычный ход родителя. Это может быть дорого на модели сессии. Timeout/cancellation распространяются на связанную работу. Для удаления отключи/удали bundle через Plugin Manager.

## Разработка

```sh
npm ci --ignore-scripts
npm run test:all
npm run test:package
```

`npm test` не требует SDK. Integration устанавливаются из публичных npm SDK пакетов, private извлечение DSH не нужно. Test adapters scripted, Auto проверяется policy-deny fixture, а не живой risk model. Живая LLM/GUI не проверены. Подробнее: [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md).

Концепция вдохновлена [официальным code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) и [опубликованным Simplify prompt](https://github.com/dsdanielpark/claude-code-system-prompts/blob/main/system-prompts/skill-simplify.md). Не аффилирован с Anthropic; промпт и политика являются самостоятельной реализацией.
