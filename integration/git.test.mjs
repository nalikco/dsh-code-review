import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, mkdir, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { Context } from '@deepseek-ai/cordis';
import LocalFs from '@deepseek-ai/dsh-fs-local';
import { collectChanges } from '../git.mjs';
import { loadEvidence, planEdits, assertUnchanged } from '../workspace.mjs';
import { DEFAULTS } from '../options.mjs';
import { createHandler } from '../engine.mjs';

const signal = new AbortController().signal;
const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
async function repo(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-git-'));
  run(root, 'init', '-q'); run(root, 'config', 'user.name', 'Fixture'); run(root, 'config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(root, 'a.js'), 'const x = 1;\n'); run(root, 'add', 'a.js'); run(root, 'commit', '-qm', 'initial');
  const ctx = new Context(); const fs = new LocalFs(ctx, { cwd: root, diffBasisMaxBytes: 100000 });
  return { root, fs };
}
test('real git includes staged, unstaged, untracked and excludes ignored', async t => {
  const { root, fs } = await repo(t);
  await writeFile(path.join(root, 'a.js'), 'const x = 2;\n'); run(root, 'add', 'a.js');
  await writeFile(path.join(root, 'a.js'), 'const x = 3;\n');
  await writeFile(path.join(root, 'new file.js'), 'new code\n');
  await writeFile(path.join(root, '.gitignore'), 'ignored\n'); await writeFile(path.join(root, 'ignored'), 'secret\n');
  const changes = await collectChanges(root, {}, DEFAULTS, signal);
  assert.deepEqual(changes.files, ['.gitignore', 'a.js', 'new file.js']); assert.match(changes.diff, /x = 3/);
  const evidence = await loadEvidence(fs, changes, DEFAULTS, signal); assert.match(evidence.evidence, /NEW FILE "new file.js"/);
});
test('real --base includes committed branch delta and working changes', async t => {
  const { root } = await repo(t); const base = run(root, 'rev-parse', 'HEAD').trim();
  await writeFile(path.join(root, 'a.js'), 'const x = 2;\n'); run(root, 'add', 'a.js'); run(root, 'commit', '-qm', 'second');
  await writeFile(path.join(root, 'a.js'), 'const x = 3;\n');
  const changes = await collectChanges(root, { base }, DEFAULTS, signal); assert.equal(changes.base, base); assert.match(changes.diff, /x = 1/); assert.match(changes.diff, /x = 3/);
});
test('unborn HEAD supports staged and untracked files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-unborn-')); run(root, 'init', '-q');
  await writeFile(path.join(root, 'a.js'), 'new\n'); run(root, 'add', 'a.js'); await writeFile(path.join(root, 'b.js'), 'untracked\n');
  const changes = await collectChanges(root, {}, DEFAULTS, signal); assert.deepEqual(changes.files, ['a.js', 'b.js']); assert.equal(changes.base, '');
});
test('real CAS writes worktree only, preserving index and concurrent foreign edits', async t => {
  const { root, fs } = await repo(t); await writeFile(path.join(root, 'a.js'), 'const x = 2;\n'); run(root, 'add', 'a.js');
  const changes = await collectChanges(root, {}, DEFAULTS, signal); const evidence = await loadEvidence(fs, changes, DEFAULTS, signal);
  const finding = { title: 'Fix x', safeToFix: true, edits: [{ file: 'a.js', oldString: 'x = 2', newString: 'x = 3' }] };
  const plan = planEdits([finding], evidence);
  assert.match(plan.planned.get('a.js').content, /x = 3/);
  assert.match(await readFile(path.join(root, 'a.js'), 'utf8'), /x = 2/); assert.match(run(root, 'show', ':a.js'), /x = 2/);
  await writeFile(path.join(root, 'a.js'), 'foreign');
  await assert.rejects(assertUnchanged(fs, evidence, DEFAULTS, signal), /изменился/);
});
test('symlink changed file is explicit unsupported coverage and cannot be edited', async t => {
  const { root, fs } = await repo(t); await symlink('/etc/passwd', path.join(root, 'link'));
  const evidence = await loadEvidence(fs, await collectChanges(root, {}, DEFAULTS, signal), DEFAULTS, signal);
  assert.match(evidence.limitations.join(), /symlinks/); assert.equal(evidence.snapshots.has('link'), false);
});
test('full engine against real git/fs read-only and --fix', async t => {
  const { root, fs } = await repo(t); await writeFile(path.join(root, 'a.js'), 'const x = 2;\n');
  const finding = { id: 'x', file: 'a.js', line: 1, category: 'bug', severity: 'high', title: 'Fix x', explanation: 'Reachable example', evidence: 'Fixture contract', safeToFix: true, edits: [{ file: 'a.js', oldString: 'x = 2', newString: 'x = 3' }] };
  const agent = { id: 'fixture', status: 'idle', session: { header: { cwd: root } }, ctx: { get(name) { return this[name]; }, fs, sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: root }) } } };
  let calls = 0;
  const { handler } = createHandler({}, {}, async (_c, _a, prompt) => { calls++; return { findings: prompt.includes('independent skeptical validator') || (calls - 1) % 4 === 0 ? [finding] : [], limitations: [] }; });
  const review = await handler({ agent, rawInput: '', signal }); assert.equal(review.kind, 'success'); assert.match(await readFile(path.join(root, 'a.js'), 'utf8'), /x = 2/);
  const fix = await handler({ agent, rawInput: '--fix', signal }); assert.equal(fix.kind, 'error'); assert.match(fix.text, /scheduler/); assert.match(await readFile(path.join(root, 'a.js'), 'utf8'), /x = 2/);
});
