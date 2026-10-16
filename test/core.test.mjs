import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseOptions, resolveConfig, DEFAULTS } from '../options.mjs';
import { collectChanges, safeRelative } from '../git.mjs';
import { readSnapshot, loadEvidence, assertUnchanged, planEdits } from '../workspace.mjs';
import { normalizeReport, deduplicate } from '../findings.mjs';
import { createHandler, mapBounded } from '../engine.mjs';

const signal = () => new AbortController().signal;
function fixture() {
  const files = new Map([['a.js', { content: 'const x = 1;\n', version: 'v1' }]]), writes = [];
  const fs = {
    processPathFromHostPath: p => p,
    resolve: async p => ({ targetKey: p, displayPath: p }), contains: (a, b) => b.displayPath.startsWith(a.displayPath + '/'),
    lstat: async p => files.has(p.replace('/repo/', '')) ? { type: 'file' } : undefined,
    stat: async t => { const v = files.get(t.displayPath.replace('/repo/', '')); return v && { type: 'file', version: v.version, size: Buffer.byteLength(v.content) }; },
    readBytes: async t => Buffer.from(files.get(t.displayPath.replace('/repo/', '')).content),
    writeText: async (t, content, expected, sig, policy) => {
      sig.throwIfAborted(); assert.notEqual(policy.mode, 'read-only');
      const file = t.displayPath.replace('/repo/', ''), value = files.get(file);
      if (expected.version !== value.version) throw new Error('FS_STALE_VERSION');
      files.set(file, { content, version: value.version + '+' }); writes.push(file);
    },
  };
  const changes = { root: '/repo', files: ['a.js'], untracked: new Set(), base: 'sha', diff: '-const x = 0;\n+const x = 1;\n' };
  const agent = { id: 'parent', status: 'idle', session: { header: { cwd: '/repo' } }, ctx: { fs, sandboxPolicy: { resolve: () => ({ mode: 'workspace-write', workspaceRoot: '/repo' }) } } };
  return { fs, files, writes, changes, agent };
}
const finding = (overrides = {}) => ({ id: 'a', file: 'a.js', line: 1, category: 'bug', severity: 'medium', title: 'Incorrect x', explanation: 'x must be 2 for caller', evidence: 'caller expects 2', safeToFix: true, edits: [{ file: 'a.js', oldString: 'x = 1', newString: 'x = 2' }], ...overrides });
const empty = () => ({ findings: [], limitations: [] });

for (const [input, expected] of [ ['', { fix: false, base: null, focus: '', help: false }], [' --fix --base main --focus "memory leaks"', { fix: true, base: 'main', focus: 'memory leaks', help: false }], ['--focus \'a b\' --help', { fix: false, base: null, focus: 'a b', help: true }] ]) test(`parse ${input}`, () => assert.deepEqual(parseOptions(input), expected));
for (const input of ['--fix --fix', '--wat', '--base', '--base -x', '--focus "x', '--base main\n--pr 1', '--base "a\nb"', '--focus \\']) test(`reject args ${JSON.stringify(input)}`, () => assert.throws(() => parseOptions(input)));
for (const file of ['../a', '/a', 'a/../b', '.git/config', 'x\\y', 'a\nb', '']) test(`reject unsafe path ${JSON.stringify(file)}`, () => assert.throws(() => safeRelative(file)));
test('config rejects unknown/fractional/huge values', () => { for (const c of [{ wat: 1 }, { maxFiles: 0 }, { maxFiles: 1.5 }, { maxFiles: 999999 }]) assert.throws(() => resolveConfig(c)); assert.deepEqual(resolveConfig(), DEFAULTS); });
test('base ref is resolved without shell interpretation', async () => {
  const calls = [];
  const out = await collectChanges('/repo', { base: 'main;touch-pwn' }, DEFAULTS, signal(), async (cwd, args) => {
    calls.push(args);
    if (args.includes('--show-toplevel')) return '/repo\n';
    if (args[0] === 'rev-parse') return 'abc\n';
    if (args[0] === 'merge-base') return 'base\n';
    if (args.includes('--name-only')) return 'a.js\0';
    return '';
  });
  assert.equal(out.base, 'base'); assert.ok(calls.some(args => args.includes('main;touch-pwn^{commit}') && args.includes('--end-of-options')));
});
test('snapshot rejects symlinks and read races', async () => {
  const { fs } = fixture(); fs.lstat = async () => ({ type: 'symlink' });
  await assert.rejects(readSnapshot(fs, '/repo', 'a.js', DEFAULTS, signal()), /regular/);
  const f = fixture(); let n = 0; f.fs.stat = async () => ({ type: 'file', version: String(n++), size: 1 });
  await assert.rejects(readSnapshot(f.fs, '/repo', 'a.js', DEFAULTS, signal()), /changed while/);
});
test('binary and oversized files are explicit limitations', async () => {
  const f = fixture(); f.files.set('a.js', { content: '\0binary', version: 'v1' });
  const evidence = await loadEvidence(f.fs, f.changes, DEFAULTS, signal());
  assert.equal(evidence.snapshots.has('a.js'), false); assert.match(evidence.limitations.join(), /binary/);
});
test('plan exact edit does not write filesystem', async () => {
  const f = fixture(), evidence = await loadEvidence(f.fs, f.changes, DEFAULTS, signal());
  const result = planEdits([finding()], evidence);
  assert.equal(result.planned.get('a.js').content, 'const x = 2;\n'); assert.equal(f.writes.length, 0);
});
test('concurrent content change blocks write', async () => {
  const f = fixture(), evidence = await loadEvidence(f.fs, f.changes, DEFAULTS, signal());
  f.files.get('a.js').version = 'foreign';
  await assert.rejects(assertUnchanged(f.fs, evidence, DEFAULTS, signal()), /изменился/);
  assert.equal(f.writes.length, 0);
});
test('ambiguous, no-op and cross-file edits do not apply', async () => {
  const f = fixture(), evidence = await loadEvidence(f.fs, f.changes, DEFAULTS, signal());
  for (const edits of [[{ file: 'a.js', oldString: '', newString: 'x' }], [{ file: 'a.js', oldString: 'not present', newString: 'x' }], [{ file: 'a.js', oldString: 'x', newString: 'x' }], [{ file: 'a.js', oldString: 'x', newString: 'z' }, { file: 'b.js', oldString: 'y', newString: 'z' }]]) assert.equal(planEdits([finding({ edits })], evidence).planned.size, 0);
});
test('findings must be in scope and within actual lines', async () => {
  const f = fixture(), evidence = await loadEvidence(f.fs, f.changes, DEFAULTS, signal());
  for (const invalid of [finding({ file: '../secret' }), finding({ file: 'b.js' }), finding({ line: 999 }), finding({ category: 'style' })]) assert.equal(normalizeReport({ findings: [invalid], limitations: [] }, evidence, 18).findings.length, 0);
  assert.equal(deduplicate([finding(), finding()]).length, 1);
});
test('bounded workers never exceed concurrency and preserve errors', async () => {
  let running = 0, max = 0;
  const result = await mapBounded([1, 2, 3, 4, 5], 3, async item => { running++; max = Math.max(max, running); await Promise.resolve(); running--; if (item === 2) throw new Error('failure'); return item; });
  assert.equal(max, 3); assert.equal(result[1].status, 'rejected'); assert.equal(result[4].value, 5);
});
test('engine review default never writes and validates candidates', async () => {
  const f = fixture(); let calls = 0;
  const { handler } = createHandler({}, {}, async (_ctx, _agent, prompt) => { calls++; return prompt.includes('independent skeptical validator') ? { findings: [finding()], limitations: [] } : calls === 1 ? { findings: [finding()], limitations: [] } : empty(); }, { collectChanges: async () => f.changes });
  const result = await handler({ agent: f.agent, rawInput: '', signal: signal() });
  assert.equal(result.kind, 'success'); assert.equal(calls, 4); assert.equal(f.writes.length, 0); assert.match(result.text, /Ошибки/);
});
test('engine --fix schedules validated proposal without host writes', async () => {
  const f = fixture(); let calls = 0, scheduled = 0;
  const { handler } = createHandler({}, {}, async (_ctx, _agent, prompt) => { calls++; return prompt.includes('independent skeptical validator') || calls === 1 ? { findings: [finding()], limitations: [] } : empty(); }, { collectChanges: async () => f.changes, scheduleFix: async ({ findings }) => { scheduled++; assert.equal(findings.length, 1); return { queued: ['a.js'], applied: [], skipped: [] }; } });
  const result = await handler({ agent: f.agent, rawInput: '--fix', signal: signal() });
  assert.equal(result.kind, 'success'); assert.equal(calls, 4); assert.equal(scheduled, 1); assert.deepEqual(f.writes, []); assert.match(result.text, /штатный ход/);
});
test('read-only parent cannot use --fix', async () => {
  const f = fixture(); f.agent.ctx.sandboxPolicy.resolve = () => ({ mode: 'read-only' });
  const { handler } = createHandler({}, {}, async () => { throw new Error('must not run'); });
  const result = await handler({ agent: f.agent, rawInput: '--fix', signal: signal() });
  assert.equal(result.kind, 'error'); assert.match(result.text, /read-only/); assert.equal(f.writes.length, 0);
});
test('all failed lanes never produce clean success', async () => {
  const f = fixture(), { handler } = createHandler({}, {}, async () => { throw new Error('provider down'); }, { collectChanges: async () => f.changes });
  const result = await handler({ agent: f.agent, rawInput: '', signal: signal() });
  assert.equal(result.kind, 'error'); assert.match(result.text, /неполная/); assert.match(result.text, /provider down/);
});
test('plugin unload cancels active review and drains workers', async () => {
  const f = fixture(); let start;
  const ready = new Promise(resolve => { start = resolve; });
  const { handler, stop } = createHandler({}, {}, async (_c, _a, _p, sig) => { start(); await new Promise((resolve, reject) => sig.addEventListener('abort', () => reject(new Error('aborted')), { once: true })); }, { collectChanges: async () => f.changes });
  const pending = handler({ agent: f.agent, rawInput: '', signal: signal() });
  await ready; stop(); const result = await pending; assert.equal(result.kind, 'error'); assert.match(result.text, /отменён/);
});
