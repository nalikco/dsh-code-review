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
  }, (error, stdout, stderr) => error ? reject(new Error(`git ${args[0]} failed: ${stderr?.trim() || error.message}`)) : resolve(stdout)));
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
  const staged = await runGit(root, ['diff', '--cached', ...diffFlags, '--unified=5', ...base ? [base] : [], '--'], signal, config.maxDiffBytes);
  const working = await runGit(root, ['diff', ...diffFlags, '--unified=5', '--'], signal, config.maxDiffBytes);
  const names = [...new Set([...stagedNames, ...workingNames])];
  const diff = `${staged ? `STAGED: base to index (may differ from current worktree)\n${staged}` : ''}${working ? `\nUNSTAGED: index to current worktree\n${working}` : ''}`;
  if (Buffer.byteLength(diff) > config.maxDiffBytes) throw new Error('Git diff exceeds configured size limit.');
  const untracked = (await runGit(root, ['ls-files', '--others', '--exclude-standard', '-z'], signal)).split('\0').filter(Boolean);
  const files = [...new Set([...names, ...untracked])].map(safeRelative).sort();
  if (files.length > config.maxFiles) throw new Error(`Изменено ${files.length} файлов, лимит ${config.maxFiles}. Сузь изменения перед review.`);
  const revisions = new Map();
  for (const file of files) {
    const sides = {};
    for (const [side, spec] of [['index', `:${file}`], ...base ? [['base', `${base}:${file}`]] : []]) {
      try {
        const text = await runGit(root, ['show', '--no-ext-diff', '--no-textconv', spec], signal, config.maxFileBytes);
        if (!text.includes('\0')) sides[side] = text;
      } catch (error) { signal?.throwIfAborted(); }
    }
    revisions.set(file, sides);
  }
  return { root, base, head: head.trim(), files, untracked: new Set(untracked), diff, revisions };
}
