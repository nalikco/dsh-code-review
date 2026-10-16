import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHandler } from '../engine.mjs';
import { normalizeReport, deduplicate } from '../findings.mjs';
import { gitEnvironment } from '../git.mjs';
const finding = { id: 'x', file: 'a.js', side: 'worktree', line: 1, category: 'bug', severity: 'high', title: 'Fix', explanation: 'scenario', evidence: 'code', safeToFix: true, edits: [{ file: 'a.js', oldString: 'one', newString: 'two' }] };
function fixture() {
  const fs = { processPathFromHostPath: x => x, resolve: async x => ({ targetKey: x, displayPath: x }), contains: (a, b) => b.displayPath.startsWith(a.displayPath + '/'), lstat: async p => p.endsWith('a.js') ? { type: 'file' } : undefined, stat: async () => ({ type: 'file', version: 1, size: 3 }), readBytes: async () => Buffer.from('one'), writeText: async () => { throw new Error('HOST WRITE FORBIDDEN'); } };
  const changes = { root: '/repo', files: ['a.js'], base: 'sha', head: 'sha', diff: 'one', untracked: new Set() };
  const agent = { id: 'a', status: 'idle', session: { header: { cwd: '/repo' } }, ctx: { fs, sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/repo' }) } } };
  return { fs, agent, changes };
}
test('Git environment strips all routing/config and index overrides', () => {
 const env = gitEnvironment({ PATH: '/bin', GIT_CONFIG: '/dev/null', GIT_DIR: '/evil', GIT_WORK_TREE: '/outside', GIT_INDEX_FILE: '/x', GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'filter.evil.clean', GIT_CONFIG_VALUE_0: 'evil' });
 assert.equal(env.PATH, '/bin'); for (const key of ['GIT_CONFIG', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_CONFIG_COUNT', 'GIT_CONFIG_KEY_0']) assert.equal(env[key], undefined);
});
test('index line validation uses index snapshot and disables worktree fix', () => {
 const evidence = { files: ['a.js'], snapshots: new Map([['a.js', { content: 'one' }]]), revisions: new Map([['a.js', { index: '1\n2\n3\n4\nbug' }]]) };
 const report = normalizeReport({ findings: [{ ...finding, side: 'index', line: 5 }], limitations: [] }, evidence, 18);
 assert.equal(report.findings.length, 1); assert.equal(report.findings[0].safeToFix, false); assert.deepEqual(report.findings[0].edits, []);
});
test('one malformed finding does not discard valid siblings', () => {
 const evidence = { files: ['a.js'], snapshots: new Map([['a.js', { content: 'one' }]]) };
 const report = normalizeReport({ findings: [{ ...finding, line: 100 }, finding], limitations: [] }, evidence, 18);
 assert.equal(report.findings.length, 1); assert.equal(report.limitations.length, 1);
});
test('dedup retains strongest candidate and does not hide bugs behind quality', () => {
 const values = deduplicate([{ ...finding, severity: 'low' }, finding, { ...finding, category: 'quality' }]);
 assert.equal(values.length, 2); assert.equal(values[0].category, 'bug'); assert.equal(values[0].severity, 'high');
});
test('diff changes during evidence acquisition fail before reviewers', async () => {
 const f = fixture(); let collections = 0, reviews = 0;
 const { handler } = createHandler({}, {}, async () => { reviews++; return { findings: [], limitations: [] }; }, { collectChanges: async () => ({ ...f.changes, diff: ++collections === 1 ? 'old' : 'new' }) });
 const result = await handler({ agent: f.agent, rawInput: '--fix', signal: new AbortController().signal });
 assert.equal(result.kind, 'error'); assert.equal(reviews, 0);
});
test('stale diff is error and never schedules fixes', async () => {
 const f = fixture(); let collections = 0, scheduled = false;
 const { handler } = createHandler({}, {}, async () => ({ findings: [finding], limitations: [] }), { collectChanges: async () => ({ ...f.changes, diff: ++collections <= 2 ? 'old' : 'new' }), scheduleFix: () => { scheduled = true; } });
 const result = await handler({ agent: f.agent, rawInput: '--fix', signal: new AbortController().signal });
 assert.equal(result.kind, 'error'); assert.equal(scheduled, false); assert.match(result.text, /устарели/);
});
test('internal unload during review cannot return success', async () => {
 const f = fixture(); let stop;
 const instance = createHandler({}, {}, async (_c, _a, _p, signal) => { stop(); signal.throwIfAborted(); }, { collectChanges: async () => f.changes }); stop = instance.stop;
 const result = await instance.handler({ agent: f.agent, rawInput: '', signal: new AbortController().signal }); assert.equal(result.kind, 'error');
});
