import path from 'node:path';
import { safeRelative } from './git.mjs';

export async function readSnapshot(fs, root, file, config, signal) {
  safeRelative(file);
  const rootTarget = await fs.resolve(root, { signal });
  const requested = path.join(root, file);
  const link = await fs.lstat(requested, {}, signal);
  if (!link) return { file, absent: true };
  if (link.type !== 'file') throw new Error(`${file}: not a regular file (symlinks are not reviewed or edited)`);
  const target = await fs.resolve(requested, { signal });
  if (!fs.contains(rootTarget, target)) throw new Error(`${file}: outside repository`);
  const before = await fs.stat(target, signal);
  if (!before || before.type !== 'file' || before.size > config.maxFileBytes) throw new Error(`${file}: missing, non-regular or over size limit`);
  const bytes = await fs.readBytes(target, signal, config.maxFileBytes);
  if (bytes.includes(0)) throw new Error(`${file}: binary file`);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const after = await fs.stat(target, signal);
  if (!after || before.version !== after.version) throw new Error(`${file}: changed while reading`);
  return { file, target, version: after.version, content, absent: false };
}

export async function loadEvidence(fs, changes, config, signal) {
  const snapshots = new Map(), limitations = [];
  let evidence = changes.diff;
  for (const file of changes.files) {
    for (const [side, text] of Object.entries(changes.revisions?.get(file) ?? {})) evidence += `\n\nVERSION ${side} ${JSON.stringify(file)}\n` + text.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
    try {
      const snapshot = await readSnapshot(fs, changes.root, file, config, signal);
      snapshots.set(file, snapshot);
      if (!snapshot.absent) {
        evidence += `\n\n${changes.untracked.has(file) ? 'NEW FILE' : 'VERSION worktree'} ${JSON.stringify(file)}\n` + snapshot.content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
      }
    } catch (error) { signal.throwIfAborted(); limitations.push(String(error.message)); }
  }
  const instructions = new Set(['AGENTS.md', 'CLAUDE.md']);
  for (const file of changes.files) {
    let dir = path.posix.dirname(file);
    while (dir !== '.') {
      instructions.add(`${dir}/AGENTS.md`); instructions.add(`${dir}/CLAUDE.md`);
      dir = path.posix.dirname(dir);
    }
  }
  for (const file of [...instructions].sort()) {
    try {
      const snapshot = await readSnapshot(fs, changes.root, file, config, signal);
      if (!snapshots.has(file)) snapshots.set(file, snapshot);
      if (!snapshot.absent) evidence += `\n\nSCOPED INSTRUCTIONS ${JSON.stringify(file)} (apply only to this directory and descendants)\n${snapshot.content}`;
    } catch (error) { signal.throwIfAborted(); limitations.push(`Instructions: ${error.message}`); }
  }
  if (Buffer.byteLength(evidence) > config.maxDiffBytes) throw new Error(`Diff и инструкции превышают ${config.maxDiffBytes} байт. Review не запущен, данные не обрезались.`);
  return { ...changes, snapshots, limitations, evidence };
}

export async function assertUnchanged(fs, evidence, config, signal) {
  for (const [file, original] of evidence.snapshots) {
    const current = await readSnapshot(fs, evidence.root, file, config, signal);
    if (current.absent !== original.absent || current.version !== original.version || current.content !== original.content || current.target?.targetKey !== original.target?.targetKey) throw new Error(`${file}: файл изменился после начала review; повтори команду.`);
  }
}

export function planEdits(findings, evidence) {
  const planned = new Map(), skipped = [];
  for (const finding of findings) {
    if (!finding.edits.length) continue;
    if (!finding.safeToFix) { skipped.push(`${finding.title}: исправление не признано безопасным`); continue; }
    // Cross-file changes are intentionally not partially applied in v0.1.
    if (new Set(finding.edits.map(edit => edit.file)).size !== 1) { skipped.push(`${finding.title}: требуется изменение нескольких файлов`); continue; }
    const staged = new Map(planned);
    try {
      for (const edit of finding.edits) {
        const original = evidence.snapshots.get(edit.file);
        if (!original || original.absent || !edit.oldString || edit.oldString === edit.newString) throw new Error('нет пригодного исходного файла или замены');
        if (/(^|\/)(AGENTS|CLAUDE)\.md$/u.test(edit.file)) throw new Error('инструкции агента не редактируются');
        const text = staged.get(edit.file)?.content ?? original.content;
        const index = text.indexOf(edit.oldString);
        if (index < 0 || text.indexOf(edit.oldString, index + 1) >= 0) throw new Error('исходный фрагмент должен совпасть ровно один раз');
        staged.set(edit.file, { ...original, content: text.slice(0, index) + edit.newString + text.slice(index + edit.oldString.length) });
      }
      planned.clear(); for (const [file, value] of staged) planned.set(file, value);
    } catch (error) { skipped.push(`${finding.title}: ${error.message}`); }
  }
  return { planned, skipped };
}
