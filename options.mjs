export const HELP = `/code-review [--fix] [--base <ref>] [--focus <text>]

Передаёт review-промпт текущему агенту в обычную очередь DSH.
По умолчанию промпт просит только анализ, без правок исходников.
--fix: просит проверить находки и исправить подтверждённые проблемы штатными инструментами.
--base <ref>: изменения относительно merge-base указанной ветки с HEAD.
--focus <text>: дополнительный фокус, несколько слов заключай в кавычки.
--help: справка без запуска агента.

Три направления: корректность/безопасность, переиспользование/качество, эффективность.
Плагин не вводит собственную песочницу, лимит diff или механизм исправлений.
Режим без правок является инструкцией в промпте, а не жёстким read-only ограничением.
Права, подтверждения, отмена, инструменты и subagents управляются самим DSH.
Commit, push, deploy и публикация комментариев не разрешаются этой командой.`;

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
