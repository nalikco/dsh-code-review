# DSH Code Review

[English](README.md) | Русский

Версия **1.1.0**, [MIT](LICENSE). Тонкая команда для [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness): передаёт текущему агенту читаемый промпт, объединяющий review корректности, качества и эффективности.

```text
/code-review
/code-review --fix
/code-review --base main
/code-review --focus "обработка ошибок"
/code-review --help
```

## Что делает плагин

1. Регистрирует `/code-review`.
2. Разбирает `--fix`, `--base`, `--focus` и `--help`.
3. Ставит [промпт](REVIEW_PROMPT.md) в обычную очередь текущего агента через `followup`.

Всё остальное делает агент штатными инструментами DSH: читает Git diff и инструкции проекта, запускает три направления review через доступные subagents, проверяет находки и выдаёт результат. Если делегирование недоступно, промпт просит пройти три направления самостоятельно и сообщить об ограничении. Модель, права, подтверждения и отмена обычного хода остаются у DSH.

**По умолчанию промпт просит не править исходники. Это инструкция агенту, не жёсткая read-only песочница.** `--fix` просит применить подтверждённые исправления и полезные локальные упрощения, проверить итоговый diff и запустить доступные релевантные проверки. Commit, push, deploy и публикацию комментариев промпт не разрешает.

`--base ref` задаёт область относительно merge-base ref/HEAD. `--focus` задаёт дополнительную тему, несколько слов заключай в кавычки. Без `--base` промпт просит staged/unstaged отдельно и untracked source files. Если изменений нет, агент должен остановиться.

Успех slash-команды означает **промпт поставлен в очередь**, не завершение review. Занятый агент закончит текущий ход прежде, чем возьмёт review. После передачи используй обычную отмену текущего/очередного хода DSH; выгрузка плагина не отменяет уже принятую задачу.

## Чего больше нет

Нет собственного сборщика Git, копий base/index/worktree в промпте, лимита 500 КБ, пакетного движка, JSON-протокола находок, model routing, ручного управления детьми, дополнительных guards или механизма исправлений. Контекст и размер чтений выбирает агент в рамках обычных ограничений DSH и модели. Старые настройки maxFiles/maxDiffBytes/maxFileBytes/maxReviewBatches/maxFindings/maxValidations/timeoutMs больше не используются.

Это сознательное упрощение. Проверка находок и соблюдение analysis-only теперь зависят от модели, как у обычной команды с промптом. Нельзя обещать гарантированно read-only исполнение или доказанную корректность review.

## Установка

В DSH **Plugins → установка bundle**:

```text
https://github.com/nalikco/dsh-code-review.git
```

Можно закрепить проверенный commit: `https://github.com/nalikco/dsh-code-review.git#<commit-sha>` или установить абсолютный путь локального клона. Не активируй другую глобальную команду `code-review` одновременно. Проверяй installation status; `restart-required` требует перезапуска.

Node.js22+, DSH service packages0.2.0-rc.2 и Cordis~4.0.4. Плагину нужен только service `commands`; `createUserMessage` берётся из штатного LLM SDK. Нет build/install scripts. `private:true` предотвращает случайную npm-публикацию, Git/local установка работает. Публикация в Git не обновляет установленный профиль автоматически.

Настройки плагина не нужны. Для удаления отключи/удали bundle в Plugin Manager.

## Данные и доверие

Агент читает исходники и отправляет контекст настроенному LLM-провайдеру, DSH может сохранять сообщения/результаты инструментов. Не проверяй закрытый код или секреты без соответствующего разрешения. Плагин не добавляет свой провайдер/телеметрию и не выполняет shell/Git самостоятельно. Подробнее: [SECURITY.md](SECURITY.md).

## Разработка

```sh
npm ci --ignore-scripts
npm run test:all
npm run test:package
```

Проверяется разбор аргументов, содержание промпта, регистрация/выгрузка, передача в текущий агент и обычная очередь на настоящем SDK, состав и активация tarball. Scripted adapter не доказывает качество живого review. Подробнее: [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md).

Идея вдохновлена [официальным code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) и [опубликованным Simplify prompt](https://github.com/dsdanielpark/claude-code-system-prompts/blob/main/system-prompts/skill-simplify.md). Самостоятельная реализация, не аффилирована с Anthropic.
