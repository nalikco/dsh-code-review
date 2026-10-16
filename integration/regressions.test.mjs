import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, access } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { collectChanges } from '../git.mjs';
import { DEFAULTS } from '../options.mjs';
import { deduplicate, normalizeReport } from '../findings.mjs';
import { Context } from '@deepseek-ai/cordis';
import LocalFs from '@deepseek-ai/dsh-fs-local';
import { loadEvidence } from '../workspace.mjs';
const run = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' });
async function repo() {
 const root = await mkdtemp(path.join(os.tmpdir(), 'review-regression-'));
 run(root, 'init', '-q'); run(root, 'config', 'user.name', 'Fixture'); run(root, 'config', 'user.email', 'fixture@example.invalid');
 await writeFile(path.join(root, 'a.js'), 'zero\n'); run(root, 'add', 'a.js'); run(root, 'commit', '-qm', 'initial'); return root;
}
test('staged and unstaged inverse diffs are both reviewed', async () => {
 const root = await repo(); await writeFile(path.join(root, 'a.js'), 'one\n'); run(root, 'add', 'a.js'); await writeFile(path.join(root, 'a.js'), 'zero\n');
 const changes = await collectChanges(root, {}, DEFAULTS, new AbortController().signal);
 assert.deepEqual(changes.files, ['a.js']); assert.match(changes.diff, /STAGED/); assert.match(changes.diff, /UNSTAGED/); assert.match(changes.diff, /\+one/);
});
test('repository clean filter cannot execute during default review', async () => {
 const root = await repo(); await writeFile(path.join(root, '.gitattributes'), '*.js filter=evil\n');
 run(root, 'config', 'filter.evil.clean', 'touch FILTER_EXECUTED; cat'); run(root, 'config', 'filter.evil.required', 'true');
 await writeFile(path.join(root, 'a.js'), 'modified\n');
 await assert.rejects(collectChanges(root, {}, DEFAULTS, new AbortController().signal), /filters/);
 await assert.rejects(access(path.join(root, 'FILTER_EXECUTED')));
});
test('Russian titles are not collapsed by ASCII-only normalization', () => {
 const a = { file: 'a.js', line: 1, severity: 'high', title: 'Потеря данных' };
 const b = { ...a, title: 'Утечка памяти' };
 assert.equal(deduplicate([a, b, { ...a }]).length, 2);
});
test('submodule diff config cannot execute nested clean filters', async () => {
 const root = await repo(), source = await repo();
 run(root, '-c', 'protocol.file.allow=always', 'submodule', 'add', '-q', source, 'sub'); run(root, 'commit', '-qam', 'submodule');
 const sub = path.join(root, 'sub');
 await writeFile(path.join(sub, '.gitattributes'), '*.js filter=evil\n');
 run(sub, 'config', 'filter.evil.clean', 'touch FILTER_EXECUTED; cat');
 run(root, 'config', 'diff.submodule', 'diff');
 await writeFile(path.join(sub, 'a.js'), 'modified\n');
 await collectChanges(root, {}, DEFAULTS, new AbortController().signal);
 await assert.rejects(access(path.join(sub, 'FILTER_EXECUTED')));
 await assert.rejects(access(path.join(root, 'FILTER_EXECUTED')));
});
test('GIT_CONFIG cannot hide executable filters from preflight', async () => {
 const root = await repo(); await writeFile(path.join(root, '.gitattributes'), '*.js filter=evil\n');
 run(root, 'config', 'filter.evil.clean', 'touch FILTER_EXECUTED; cat'); await writeFile(path.join(root, 'a.js'), 'dirty\n');
 const previous = process.env.GIT_CONFIG; process.env.GIT_CONFIG = '/dev/null';
 try { await assert.rejects(collectChanges(root, {}, DEFAULTS, new AbortController().signal), /filters/); }
 finally { if (previous === undefined) delete process.env.GIT_CONFIG; else process.env.GIT_CONFIG = previous; }
 await assert.rejects(access(path.join(root, 'FILTER_EXECUTED')));
});
test('orphan unborn branch works with other refs present', async () => {
 const root = await repo(); run(root, 'checkout', '--orphan', 'empty');
 await writeFile(path.join(root, 'a.js'), 'new branch\n'); run(root, 'add', 'a.js');
 const changes = await collectChanges(root, {}, DEFAULTS, new AbortController().signal); assert.equal(changes.base, ''); assert.ok(changes.files.includes('a.js'));
});
test('staged line beyond worktree length remains a valid index finding', async () => {
 const root = await repo(); await writeFile(path.join(root, 'a.js'), '1\n2\n3\n4\nmissing()\n'); run(root, 'add', 'a.js'); await writeFile(path.join(root, 'a.js'), 'zero\n');
 const signal = new AbortController().signal, ctx = new Context(); new LocalFs(ctx, { cwd: root, diffBasisMaxBytes: 100000 });
 const evidence = await loadEvidence(ctx.fs, await collectChanges(root, {}, DEFAULTS, signal), DEFAULTS, signal);
 const finding = { id: 'x', side: 'index', file: 'a.js', line: 5, title: 'Missing', category: 'bug', severity: 'high', explanation: 'undefined call', evidence: 'missing()', safeToFix: true, edits: [] };
 const report = normalizeReport({ findings: [finding], limitations: [] }, evidence, 18); assert.equal(report.findings.length, 1); assert.equal(report.findings[0].safeToFix, false);
});
test('per-file collection uses literal pathspecs for wildcard filenames', async () => {
 const root = await repo(); await writeFile(path.join(root, '[a].js'), 'literal old\n'); await writeFile(path.join(root, 'a.js'), 'ordinary old\n'); run(root, 'add', '.'); run(root, 'commit', '-qm', 'paths');
 await writeFile(path.join(root, '[a].js'), 'literal new\n'); await writeFile(path.join(root, 'a.js'), 'ordinary new\n');
 const changes = await collectChanges(root, {}, DEFAULTS, new AbortController().signal);
 assert.match(changes.fileDiffs.get('[a].js'), /literal new/); assert.doesNotMatch(changes.fileDiffs.get('[a].js'), /ordinary new/);
 assert.match(changes.fileDiffs.get('a.js'), /ordinary new/); assert.doesNotMatch(changes.fileDiffs.get('a.js'), /literal new/);
});
test('real aggregate diff above budget is split without stopping collection', async () => {
 const root = await repo();
 for (const name of ['a.js', 'b.js', 'c.js']) await writeFile(path.join(root, name), 'old\n'); run(root, 'add', '.'); run(root, 'commit', '-qm', 'three');
 for (const name of ['a.js', 'b.js', 'c.js']) await writeFile(path.join(root, name), ('changed ' + name + '\n').repeat(8000));
 const config = { ...DEFAULTS, maxDiffBytes: 200000 }, signal = new AbortController().signal;
 const changes = await collectChanges(root, {}, config, signal); assert.ok(Buffer.byteLength(changes.diff) > config.maxDiffBytes);
 const ctx = new Context(); new LocalFs(ctx, { cwd: root, diffBasisMaxBytes: 100000 });
 const evidence = await loadEvidence(ctx.fs, changes, config, signal); assert.ok(evidence.batches.length > 1); assert.deepEqual(evidence.batches.flatMap(b => b.files), changes.files);
});
test('oversized historical snapshot is explicit maxFileBytes error', async () => {
 const root = await repo(); await writeFile(path.join(root, 'a.js'), 'x'.repeat(1000)); run(root, 'add', 'a.js');
 await assert.rejects(collectChanges(root, {}, { ...DEFAULTS, maxFileBytes: 100 }, new AbortController().signal), /index:a.js: превышен maxFileBytes/);
});
