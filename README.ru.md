# DSH Code Review

[English](README.md) | Русский

Версия **1.2.2**, [MIT](LICENSE). Небольшая команда `/code-review` на базе **штатного DSH skill**: корректность/безопасность, переиспользование/качество и эффективность.

```text
/code-review
/code-review --fix
/code-review --base main
/code-review --focus "обработка ошибок"
/code-review --help
```

## Skill вместо сообщения от пользователя

Плагин регистрирует [REVIEW_PROMPT.md](REVIEW_PROMPT.md) как skill `dsh-code-review`, доступный только для явного вызова. Команда ставит в очередь **одно** сообщение с полными отрендеренными инструкциями `<skill_content>` и параметрами mode/base/focus, помеченное `source.kind: 'skill-invocation'`. Ничего не пишется от имени пользователя: Chat показывает штатный чип вызова skill, а не пузырь, похожий на написанный человеком текст; текста review с источником `user` в сессии не появляется.

Инструкции едут внутри самого сообщения очереди, поэтому штатный `dsh-tool-skill` (сканер жестов `/name`) не участвует, а поставленный review выполняется по своим инструкциям даже после выгрузки плагина.

Агент обычными инструментами читает diff/инструкции проекта, запускает три направления через доступные subagents, проверяет находки и выдаёт результат. Если делегирование недоступно, skill просит три прохода самостоятельно и честное описание ограничения. `modelInvocable:false` не даёт модели автоматически выбирать этот skill; установка сама review не запускает.

**Без правок является инструкцией, а не дополнительной жёсткой песочницей.** `--fix` просит применить подтверждённые исправления/локальные упрощения, проверить diff и запустить доступные релевантные проверки. Commit, push, deploy и публикация комментариев не разрешаются. Права, Auto, plan mode, инструменты, модель и отмена остаются у DSH.

* Default: staged/unstaged отдельно и relevant untracked source files, без правок.
* `--fix`: исправления после review штатными инструментами.
* `--base ref`: область относительно merge-base ref/HEAD с working-tree changes.
* `--focus`: тема; несколько слов и значения, начинающиеся с флагов, в кавычках.
* `--help`: справка без запуска агента.

Кавычки не выполняют shell expansion. Regex/пути сохраняют backslashes; `\"` и `\\` экранируют кавычку/слэш в двойных кавычках. Параметры передаются как JSON, `/` записывается `\u002f`, чтобы скопированный текст вызова не мог вызвать посторонний skill. Composer attachments не принимаются.

Успех команды означает **поставлено в очередь**, не завершено. Занятый агент сначала завершит текущий ход, затем использует обычные DSH queue/turn controls. Сообщение очереди несёт инструкции с собой, поэтому отключение или удаление плагина после постановки в очередь не отменяет уже поставленную работу.

## Установка

DSH **Plugins → установка bundle**:

```text
https://github.com/nalikco/dsh-code-review.git
```

Можно закрепить проверенный commit через `#<commit-sha>` или поставить абсолютный путь локального клона. Проверяй installation status; `restart-required` требует перезапуска. Push не обновляет установленный профиль автоматически.

Нужны Node22+, SDK DSH0.2.1-rc.2 (peers 0.2.0-rc.2/0.2.1-rc.1 сохранены), Cordis~4.0.5 и services `commands`/`skills`. Настроек/build/install scripts нет. `private:true` защищает от случайного npm publish, Git/local установка работает. Удаление через Plugin Manager.

Не регистрируй другую глобальную `code-review` команду или project/user/preset skill `dsh-code-review`: конфликтующая регистрация затенит skill и собьёт штатный жест `/dsh-code-review` при прямом наборе.

## Простота и доверие

Нет своего сборщика Git, copies snapshots, diff-size лимита/пакетов, finding JSON, model routing, управления детьми, guards или fix scheduler. Агент выбирает контекст в обычных пределах DSH/модели. Старые engine-настройки не используются. Как у обычного skill, качество и analysis-only зависят от модели.

Исходники/результаты могут отправляться настроенному провайдеру и сохраняться в DSH. Используй только разрешённые данные. Телеметрии и отдельного провайдера нет. Подробнее: [SECURITY.md](SECURITY.md).

## Разработка

```sh
npm ci --ignore-scripts
npm run test:all
npm run test:package
```

Тесты проверяют, что сообщения очереди помечены `skill-invocation` и не содержат текста с источником `user`, несут полные инструкции и параметры, а также покрывают очередь/отмену/выгрузку и tarball. Scripted adapter не доказывает live LLM accuracy или GUI. [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md).

Идея вдохновлена [официальным code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) и [опубликованным Simplify prompt](https://github.com/dsdanielpark/claude-code-system-prompts/blob/main/system-prompts/skill-simplify.md). Самостоятельная реализация, не аффилирована с Anthropic.
