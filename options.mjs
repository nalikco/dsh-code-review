export const HELP = `/code-review [--fix] [--base <ref>] [--focus <text>]

По умолчанию: анализ staged, unstaged и untracked файлов без записи.
--base <ref>: изменения от merge-base с указанной веткой до рабочего дерева.
--fix: передать подтверждённые замены в обычный ход родителя через штатный edit. Tool guards, Auto, read-only и plan mode сохраняются; завершение команды не означает завершение исправлений. После хода повтори /code-review.
--focus <text>: дополнительный фокус, не расширяющий права команды.
--help: справка.

Никаких commit, push, GitHub-комментариев или запуска команд из репозитория.
PR и автоматический запуск тестов не поддерживаются.
Большая область разбивается по файлам на пакеты до maxDiffBytes (500000 байт), не более maxReviewBatches (8). Полные версии файлов не дублируются в промпте. Превышение лимита одного файла или числа пакетов останавливает команду без обрезки.
Не редактируй файлы параллельно с --fix: проверка версии SDK не является атомарным CAS относительно внешнего редактора.`;

function tokenize(input) {
  const tokens = []; let token = '', quote = null, started = false;
  for (let i = 0; i < input.length; i++) {
    const ch = input[i];
    if (ch === '\\' && quote !== "'") {
      if (++i >= input.length) throw new Error('Незавершённое экранирование.');
      token += input[i]; started = true;
    } else if (quote) {
      if (ch === quote) quote = null; else token += ch;
    } else if (ch === '"' || ch === "'") { quote = ch; started = true; }
    else if (/\s/u.test(ch)) { if (started) tokens.push(token); token = ''; started = false; }
    else { token += ch; started = true; }
  }
  if (quote) throw new Error('Незакрытая кавычка.');
  if (started) tokens.push(token);
  return tokens;
}

export function parseOptions(input = '') {
  if (input.length > 8000) throw new Error('Слишком длинные аргументы.');
  const tokens = tokenize(input), result = { fix: false, base: null, focus: '', help: false }, seen = new Set();
  for (let i = 0; i < tokens.length; i++) {
    const flag = tokens[i];
    if (!['--fix', '--base', '--focus', '--help'].includes(flag)) throw new Error(`Неизвестный аргумент: ${flag}. Используй /code-review --help.`);
    if (seen.has(flag)) throw new Error(`Повторный аргумент: ${flag}`);
    seen.add(flag);
    if (flag === '--fix') result.fix = true;
    else if (flag === '--help') result.help = true;
    else {
      const value = tokens[++i];
      if (!value || value.startsWith('--') || /[\x00-\x1f\x7f]/u.test(value)) throw new Error(`Некорректное значение ${flag}.`);
      if (flag === '--base') {
        if (value.startsWith('-') || value.length > 256) throw new Error('Некорректный git ref.');
        result.base = value;
      } else result.focus = value;
    }
  }
  return result;
}

export const DEFAULTS = Object.freeze({ maxFiles: 80, maxDiffBytes: 500000, maxFileBytes: 250000, maxReviewBatches: 8, maxFindings: 18, maxValidations: 12, timeoutMs: 600000 });
export function resolveConfig(config = {}) {
  const result = { ...DEFAULTS };
  for (const [key, value] of Object.entries(config)) {
    if (!(key in DEFAULTS) || !Number.isSafeInteger(value) || value < 1 || value > DEFAULTS[key] * 4) throw new Error(`Invalid dsh-code-review config: ${key}`);
    result[key] = value;
  }
  return result;
}
