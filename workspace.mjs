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
  if (!before || before.type !== 'file') throw new Error(`${file}: missing or non-regular file`);
  if (before.size > config.maxFileBytes) throw Object.assign(new Error(`${file}: превышен maxFileBytes=${config.maxFileBytes}`), { code: 'REVIEW_FILE_TOO_LARGE' });
  const bytes = await fs.readBytes(target, signal, config.maxFileBytes);
  if (bytes.includes(0)) throw new Error(`${file}: binary file`);
  const content = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  const after = await fs.stat(target, signal);
  if (!after || before.version !== after.version) throw new Error(`${file}: changed while reading`);
  return { file, target, version: after.version, content, absent: false };
}

export async function loadEvidence(fs, changes, config, signal) {
  const snapshots = new Map(), limitations = [], fileEvidence = new Map(), instructionEvidence = new Map();
  for (const file of changes.files) {
    let text = changes.fileDiffs?.get(file) ?? (file === changes.files[0] ? changes.diff : '');
    const versions = {};
    for (const [side, content] of Object.entries(changes.revisions?.get(file) ?? {})) versions[side] = { lines: content.split('\n').length };
    try {
      const snapshot = await readSnapshot(fs, changes.root, file, config, signal);
      snapshots.set(file, snapshot);
      if (!snapshot.absent) {
        versions.worktree = { lines: snapshot.content.split('\n').length };
        if (changes.untracked.has(file)) text += `\n\nNEW FILE ${JSON.stringify(file)}\n` + snapshot.content.split('\n').map((line, i) => `${i + 1}: ${line}`).join('\n');
      }
    } catch (error) { signal.throwIfAborted(); if (['REVIEW_FILE_TOO_LARGE', 'FS_TOO_LARGE'].includes(error.code)) throw error; limitations.push(String(error.message)); }
    text += `\n\nAVAILABLE VERSIONS ${JSON.stringify(file)} ${JSON.stringify(versions)}\nFull snapshots are retained by the reviewer host, not repeated here. Read current worktree context with read/glob/grep; base/index context is limited to the supplied diff.`;
    fileEvidence.set(file, text);
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
      if (!snapshot.absent) instructionEvidence.set(file, `\n\nSCOPED INSTRUCTIONS ${JSON.stringify(file)} (apply only to this directory and descendants)\n${snapshot.content}`);
    } catch (error) { signal.throwIfAborted(); if (['REVIEW_FILE_TOO_LARGE', 'FS_TOO_LARGE'].includes(error.code)) throw error; limitations.push(`Instructions: ${error.message}`); }
  }
  const batches = [];
  const render = files => {
    const scoped = [...instructionEvidence].filter(([instruction]) => {
      const dir = path.posix.dirname(instruction);
      return dir === '.' || files.some(file => file.startsWith(dir + '/'));
    }).map(([, text]) => text);
    return [...files.map(file => fileEvidence.get(file)), ...scoped].join('\n');
  };
  let current = [];
  for (const file of changes.files) {
    const single = render([file]);
    if (Buffer.byteLength(single) > config.maxDiffBytes) throw new Error(`${file}: diff, содержимое или инструкции одного файла превышают ${config.maxDiffBytes} байт. Увеличь maxDiffBytes или сузь изменения. Данные не обрезались.`);
    if (current.length && Buffer.byteLength(render([...current, file])) > config.maxDiffBytes) {
      batches.push({ files: current, evidence: render(current) }); current = [];
    }
    current.push(file);
  }
  if (current.length) batches.push({ files: current, evidence: render(current) });
  const maxBatches = config.maxReviewBatches ?? 8;
  if (batches.length > maxBatches) throw new Error(`Нужно ${batches.length} пакетов review, лимит maxReviewBatches=${maxBatches}. Сузь изменения или увеличь лимит. Ничего не пропущено.`);
  return { ...changes, snapshots, limitations, batches, evidence: batches.length === 1 ? batches[0].evidence : '' };
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
