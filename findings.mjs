import { safeRelative } from './git.mjs';
const str = { type: 'string', required: true };
export const REPORT_PARAMETERS = {
  findings: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: {
    id: str, category: { ...str, enum: ['bug', 'quality', 'efficiency'] }, severity: { ...str, enum: ['high', 'medium', 'low'] },
    side: { type: 'string', enum: ['worktree', 'index', 'base'] }, file: str, line: { type: 'integer', required: true }, title: str, explanation: str, evidence: str,
    safeToFix: { type: 'boolean', required: true }, edits: { type: 'array', required: true, items: { type: 'object', additionalProperties: false, properties: { file: str, oldString: str, newString: str } } },
  } } }, limitations: { type: 'array', required: true, items: { type: 'string' } },
};
export function normalizeReport(report, evidence, maxFindings) {
  if (!report || !Array.isArray(report.findings) || !Array.isArray(report.limitations)) throw new Error('Review did not return a structured report');
  const limitations = report.limitations.map(s => String(s).slice(0, 4000)).slice(0, 30), findings = [];
  if (report.findings.length > maxFindings) limitations.push(`Число находок ограничено ${maxFindings}, остальные не проверены.`);
  for (const f of report.findings.slice(0, maxFindings)) {
    try {
      if (!f || !['bug', 'quality', 'efficiency'].includes(f.category) || !['high', 'medium', 'low'].includes(f.severity)) throw new Error('Invalid finding classification');
      safeRelative(f.file);
      if (!evidence.files.includes(f.file) || !Number.isSafeInteger(f.line) || f.line < 1) throw new Error('Finding outside review scope');
      const side = f.side ?? 'worktree';
      if (!['worktree', 'index', 'base'].includes(side)) throw new Error('Invalid finding side');
      const snapshot = evidence.snapshots.get(f.file);
      const text = side === 'worktree' ? (!snapshot?.absent ? snapshot?.content : undefined) : evidence.revisions?.get(f.file)?.[side];
      if (typeof text !== 'string' || f.line > text.split('\n').length) throw new Error(`Finding line outside ${side} version`);
      for (const key of ['id', 'title', 'explanation', 'evidence']) if (typeof f[key] !== 'string' || !f[key].trim() || f[key].length > 6000) throw new Error(`Invalid finding ${key}`);
      if (!Array.isArray(f.edits) || f.edits.length > 8 || typeof f.safeToFix !== 'boolean') throw new Error('Invalid fix proposal');
      for (const edit of f.edits) {
        safeRelative(edit.file);
        if (edit.file !== f.file || typeof edit.oldString !== 'string' || typeof edit.newString !== 'string' || edit.oldString.length > 30000 || edit.newString.length > 30000) throw new Error('Invalid or cross-file edit proposal');
      }
      findings.push({ ...f, side, safeToFix: side === 'worktree' && f.safeToFix, edits: side === 'worktree' ? f.edits.map(e => ({ ...e })) : [] });
    } catch (error) { limitations.push(`Пропущена некорректная находка: ${error.message}`); }
  }
  return { findings, limitations };
}
const rank = f => ['high', 'medium', 'low'].indexOf(f.severity);
export function deduplicate(findings) {
  const seen = new Set();
  return [...findings].sort((a, b) => rank(a) - rank(b) || Number(b.category === 'bug') - Number(a.category === 'bug')).filter(f => {
    const key = `${f.file}\0${f.side ?? 'worktree'}\0${f.category}\0${f.line}\0${f.title.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')}`;
    if (seen.has(key)) return false; seen.add(key); return true;
  });
}
export function formatReport({ evidence, findings, limitations, fix, verification, stale }) {
  const lines = ['## Code review', '', `Область: ${evidence.files.length} файлов. Режим: ${fix ? 'review и передача исправлений в штатный ход' : 'без записи'}.`];
  if (stale) lines.push('', '**Изменения устарели во время анализа. Результаты предварительные, исправления не передавались.**');
  for (const [label, categories] of [['Ошибки', ['bug']], ['Улучшения', ['quality', 'efficiency']]]) {
    const items = findings.filter(f => categories.includes(f.category)); if (!items.length) continue;
    lines.push('', `### ${label}`);
    for (const f of items) {
      const location = f.side && f.side !== 'worktree' ? `${f.file}:${f.line} (${f.side}, не текущий файл)` : `[${f.file}:${f.line}](<${evidence.root}/${f.file}#L${f.line}>)`;
      lines.push('', `**[${f.severity}] ${f.title.replace(/[\r\n]/gu, ' ')}**`, location, f.explanation, `Подтверждение: ${f.evidence}`);
    }
  }
  if (!findings.length) lines.push('', limitations.length ? 'Подтверждённых находок нет. Проверка неполная, см. ограничения.' : 'Подтверждённых ошибок и существенных улучшений не найдено.');
  if (fix) {
    lines.push('', '### Исправления');
    for (const file of fix.queued ?? []) lines.push(`- Передан в штатный ход [${file}](<${evidence.root}/${file}>), это ещё не подтверждение записи.`);
    if (!fix.queued?.length) lines.push('Исправления не переданы.');
    for (const skip of fix.skipped) lines.push(`- Пропущено: ${skip}`);
  }
  if (verification) lines.push('', `Дальнейшая проверка: ${verification}`);
  lines.push('', 'Тесты, typecheck и линтер плагин не запускает. Commit, push и публикация комментариев не выполнялись.');
  if (limitations.length) lines.push('', '### Ограничения', ...[...new Set(limitations)].map(s => `- ${s}`));
  return lines.join('\n');
}
