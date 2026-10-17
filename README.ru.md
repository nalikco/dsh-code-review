# DSH Code Review

[English](README.md) | Русский

Версия **1.2.1**, [MIT](LICENSE). Небольшая команда `/code-review` на базе **штатного DSH skill**: корректность/безопасность, переиспользование/качество и эффективность.

```text
/code-review
/code-review --fix
/code-review --base main
/code-review --focus "обработка ошибок"
/code-review --help
```

## Skill вместо полного сообщения от пользователя

Плагин регистрирует [REVIEW_PROMPT.md](REVIEW_PROMPT.md) как skill `dsh-code-review`, доступный только для явного вызова. Команда ставит в очередь **короткое** сообщение `/dsh-code-review` с режимом/base/focus. Штатный `dsh-tool-skill` распознаёт вызов и добавляет полные инструкции с источником **`skill-invocation`**, а не как написанный тобой текст.

Модель по-прежнему получает инструкции в user-role skill context. Текущий Chat DSH обрабатывает его как штатный контекст skill, не большой пользовательский пузырь; точное отображение зависит от версии DSH. Своего renderer/UI нет. Постоянную секцию system prompt и собственный review engine не добавляем.

Агент обычными инструментами читает diff/инструкции проекта, запускает три направления через доступные subagents, проверяет находки и выдаёт результат. Если делегирование недоступно, skill просит три прохода самостоятельно и честное описание ограничения. `modelInvocable:false` не даёт модели автоматически выбирать этот skill; установка сама review не запускает.

**Без правок является инструкцией, а не дополнительной жёсткой песочницей.** `--fix` просит применить подтверждённые исправления/локальные упрощения, проверить diff и запустить доступные релевантные проверки. Commit, push, deploy и публикация комментариев не разрешаются. Права, Auto, plan mode, инструменты, модель и отмена остаются у DSH.

* Default: staged/unstaged отдельно и relevant untracked source files, без правок.
* `--fix`: исправления после review штатными инструментами.
* `--base ref`: область относительно merge-base ref/HEAD с working-tree changes.
* `--focus`: тема; несколько слов и значения, начинающиеся с флагов, в кавычках.
* `--help`: справка без запуска агента.

Кавычки не выполняют shell expansion. Regex/пути сохраняют backslashes; `\"` и `\\` экранируют кавычку/слэш в двойных кавычках. Параметры передаются как JSON, `/` записывается `\u002f`, чтобы текст focus не вызывал посторонний skill. Composer attachments не принимаются.

Успех команды означает **поставлено в очередь**, не завершено и даже не обязательно загружено. Занятый агент сначала завершит текущий ход. **Не отключай плагин до загрузки skill.** Выгрузка удаляет регистрацию команды/skill, но не принятые сообщения очереди. Отложенный вызов тогда останется без инструкций и просит агента остановиться/сообщить об этом. Уже загруженные инструкции остаются в истории. После передачи используйте обычные DSH queue/turn controls.

## Установка

DSH **Plugins → установка bundle**:

```text
https://github.com/nalikco/dsh-code-review.git
```

Можно закрепить проверенный commit через `#<commit-sha>` или поставить абсолютный путь локального клона. Проверяй installation status; `restart-required` требует перезапуска. Push не обновляет установленный профиль автоматически.

Нужны Node22+, SDK DSH0.2.1-rc.1/Cordis~4.0.5, services `commands`/`skills` и **активный штатный `dsh-tool-skill` в композиции агента**. Само наличие npm peer dependency его не активирует. Если skills выключены в preset, сначала включи штатную capability.

Не регистрируй другую глобальную `code-review` команду или project/user/preset skill `dsh-code-review`: стандартный приоритет registry может заменить bundled skill. Настроек/build/install scripts нет. `private:true` защищает от случайного npm publish, Git/local установка работает. Удаление через Plugin Manager.

## Простота и доверие

Нет своего сборщика Git, copies snapshots, diff-size лимита/пакетов, finding JSON, model routing, управления детьми, guards или fix scheduler. Агент выбирает контекст в обычных пределах DSH/модели. Старые engine-настройки не используются. Как у обычного skill, качество и analysis-only зависят от модели.

Исходники/результаты могут отправляться настроенному провайдеру и сохраняться в DSH. Используй только разрешённые данные. Телеметрии и отдельного провайдера нет. Подробнее: [SECURITY.md](SECURITY.md).

## Разработка

```sh
npm ci --ignore-scripts
npm run test:all
npm run test:package
```

Тесты различают короткое source:user сообщение и полные skill-invocation инструкции, проверяют native gesture, параметры, очередь/отмену/выгрузку и tarball. Scripted adapter не доказывает live LLM accuracy или GUI. [CONTRIBUTING.md](CONTRIBUTING.md), [CHANGELOG.md](CHANGELOG.md).

Идея вдохновлена [официальным code-review plugin](https://github.com/anthropics/claude-code/blob/main/plugins/code-review/commands/code-review.md) и [опубликованным Simplify prompt](https://github.com/dsdanielpark/claude-code-system-prompts/blob/main/system-prompts/skill-simplify.md). Самостоятельная реализация, не аффилирована с Anthropic.
