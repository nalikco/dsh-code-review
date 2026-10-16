import { execFile } from 'node:child_process';
import path from 'node:path';

export function gitEnvironment(source = process.env) {
  const env = Object.fromEntries(Object.entries(source).filter(([key]) => !/^GIT_/iu.test(key)));
  return { ...env, GIT_OPTIONAL_LOCKS: '0', GIT_TERMINAL_PROMPT: '0', GIT_PAGER: 'cat', GIT_NO_LAZY_FETCH: '1' };
}

function execGit(cwd, args, signal, maxBuffer) {
  signal?.throwIfAborted();
  return new Promise((resolve, reject) => execFile('git', ['--no-pager', '-c', 'core.fsmonitor=false', '-c', 'core.quotePath=false', '-c', 'core.hooksPath=/dev/null', '-c', 'diff.submodule=short', '-c', 'submodule.recurse=false', ...args], {
    cwd, signal, timeout: 30000, maxBuffer, encoding: 'utf8', windowsHide: true,
    env: gitEnvironment(),
  }, (error, stdout, stderr) => error ? reject(Object.assign(new Error(`git ${args[0]} failed: ${stderr?.trim() || error.message}`), { code: error.code })) : resolve(stdout)));
}

export async function git(cwd, args, signal, maxBuffer = 2000000) {
  // Working-tree diff can execute clean/process filters even with --no-ext-diff.
  // Config listing itself cannot invoke those helpers. Reject rather than guess
  // which global, included, local or environment-owned driver will be selected.
  if (args[0] === 'diff') {
    const config = await execGit(cwd, ['config', '--null', '--list'], signal, 1000000);
    const unsafe = config.split('\0').find(entry => /^(filter\..+\.(clean|process)|extensions\.partialclone|remote\..+\.promisor)\n/iu.test(entry));
    if (unsafe) throw new Error(`Git executable filters or partial clone are unsupported: ${unsafe.split('\n')[0]}`);
  }
  return execGit(cwd, args, signal, maxBuffer);
}

export function safeRelative(file) {
  if (!file || file.includes('\\') || /[\x00-\x1f\x7f]/u.test(file) || path.posix.isAbsolute(file) || file.split('/').some(p => !p || p === '..' || p === '.git')) throw new Error(`Unsafe repository path: ${JSON.stringify(file)}`);
  return file;
}

export async function collectChanges(cwd, options, config, signal, runGit = git) {
  if (!cwd || !path.isAbsolute(cwd)) throw new Error('Сессия должна иметь абсолютный cwd Git-репозитория.');
  const root = (await runGit(cwd, ['rev-parse', '--show-toplevel'], signal)).trim();
  const head = await runGit(root, ['rev-parse', '--verify', 'HEAD'], signal).catch(async error => {
    signal?.throwIfAborted();
    // Unborn orphan branches may coexist with other refs.
    const branch = (await runGit(root, ['symbolic-ref', '--quiet', 'HEAD'], signal)).trim();
    if (!branch.startsWith('refs/heads/')) throw error;
    const exists = await runGit(root, ['show-ref', '--verify', '--quiet', branch], signal).then(() => true, () => false);
    signal?.throwIfAborted();
    if (exists) throw error;
    return '';
  });
  let base = head.trim();
  if (options.base) {
    const ref = (await runGit(root, ['rev-parse', '--verify', '--end-of-options', `${options.base}^{commit}`], signal)).trim();
    base = (await runGit(root, ['merge-base', 'HEAD', ref], signal)).trim();
  }
  const diffFlags = ['--no-ext-diff', '--no-textconv', '--no-renames'];
  const stagedNames = (await runGit(root, ['diff', '--cached', '--name-only', '-z', ...diffFlags, ...base ? [base] : [], '--'], signal)).split('\0').filter(Boolean);
  const workingNames = (await runGit(root, ['diff', '--name-only', '-z', ...diffFlags, '--'], signal)).split('\0').filter(Boolean);
  const names = [...new Set([...stagedNames, ...workingNames])];
  const untracked = (await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'], signal)).split('\0').filter(Boolean);
  const files = [...new Set([...names, ...untracked])].map(safeRelative).sort();
  if (files.length > config.maxFiles) throw new Error(`Изменено ${files.length} файлов, лимит ${config.maxFiles}. Сузь изменения перед review.`);
  const revisions = new Map(), fileDiffs = new Map();
  const stagedSet = new Set(stagedNames), workingSet = new Set(workingNames);
  for (const file of files) {
    const literal = `:(literal)${file}`;
    const staged = stagedSet.has(file) ? await runGit(root, ['diff', '--cached', ...diffFlags, '--unified=5', ...base ? [base] : [], '--', literal], signal, config.maxDiffBytes) : '';
    const working = workingSet.has(file) ? await runGit(root, ['diff', ...diffFlags, '--unified=5', '--', literal], signal, config.maxDiffBytes) : '';
    const patch = `${staged ? `STAGED: base to index (old lines=base, new lines=index)\n${staged}` : ''}${working ? `\nUNSTAGED: index to worktree (old lines=index, new lines=worktree)\n${working}` : ''}`;
    if (Buffer.byteLength(patch) > config.maxDiffBytes) throw new Error(`${file}: diff одного файла превышает ${config.maxDiffBytes} байт. Сузь изменения или увеличь maxDiffBytes.`);
    fileDiffs.set(file, patch);
    const sides = {};
    for (const [side, spec] of [['index', `:${file}`], ...base ? [['base', `${base}:${file}`]] : []]) {
      try {
        const text = await runGit(root, ['show', '--no-ext-diff', '--no-textconv', spec], signal, config.maxFileBytes);
        if (!text.includes('\0')) sides[side] = text;
      } catch (error) { signal?.throwIfAborted(); if (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') throw new Error(`${side}:${file}: превышен maxFileBytes=${config.maxFileBytes}. Сузь изменения или увеличь лимит.`); }
    }
    revisions.set(file, sides);
  }
  const diff = [...fileDiffs.values()].join('\n');
  return { root, base, head: head.trim(), files, untracked: new Set(untracked), diff, revisions, fileDiffs };
}
