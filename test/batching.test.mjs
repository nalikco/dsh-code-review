import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadEvidence } from '../workspace.mjs';
import { DEFAULTS } from '../options.mjs';
import { createHandler } from '../engine.mjs';
function fixture(contents, patches, instructions = {}) {
  const files = Object.keys(contents).sort(), data = new Map(Object.entries({ ...contents, ...instructions }));
  const fs = {
    processPathFromHostPath: p => p, resolve: async p => ({ targetKey: p, displayPath: p }), contains: (a, b) => b.displayPath.startsWith(a.displayPath + '/'),
    lstat: async p => data.has(p.slice('/repo/'.length)) ? { type: 'file' } : undefined,
    stat: async t => { const text = data.get(t.displayPath.slice('/repo/'.length)); return text === undefined ? undefined : { type: 'file', version: text, size: Buffer.byteLength(text) }; },
    readBytes: async t => Buffer.from(data.get(t.displayPath.slice('/repo/'.length))),
  };
  const changes = { root: '/repo', head: 'head', base: 'base', files, untracked: new Set(), fileDiffs: new Map(files.map(f => [f, patches[f] ?? ''])), diff: Object.values(patches).join('\n'), revisions: new Map(files.map(f => [f, { index: contents[f], base: contents[f] }])) };
  const scope = { get(name) { return name === 'fs' ? fs : name === 'sandboxPolicy' ? { resolve: () => ({ mode: 'read-only' }) } : undefined; } };
  const agent = { id: 'batch-parent', status: 'idle', session: { header: { cwd: '/repo' } }, ctx: scope };
  return { fs, changes, agent };
}
const signal = () => new AbortController().signal;
test('tiny diff in large files does not duplicate base/index/worktree snapshots', async () => {
  const large = 'unchanged context\n'.repeat(10000);
  const f = fixture({ 'a.js': large, 'b.js': large }, { 'a.js': '+changedA', 'b.js': '+changedB' });
  const evidence = await loadEvidence(f.fs, f.changes, DEFAULTS, signal());
  assert.equal(evidence.batches.length, 1); assert.ok(Buffer.byteLength(evidence.evidence) < 2000);
  assert.equal(evidence.snapshots.get('a.js').content, large); assert.equal(evidence.revisions.get('a.js').index, large);
  assert.ok(!evidence.evidence.includes('unchanged context')); assert.match(evidence.evidence, /AVAILABLE VERSIONS/);
});
test('aggregate over 500KB is packed by complete file with no omission', async () => {
  const f = fixture({ 'a.js': 'x', 'b.js': 'x', 'c.js': 'x' }, { 'a.js': 'A'.repeat(200000), 'b.js': 'B'.repeat(200000), 'c.js': 'C'.repeat(200000) });
  const evidence = await loadEvidence(f.fs, f.changes, DEFAULTS, signal());
  assert.equal(evidence.batches.length, 2); assert.deepEqual(evidence.batches.flatMap(b => b.files), f.changes.files);
  for (const batch of evidence.batches) assert.ok(Buffer.byteLength(batch.evidence) <= DEFAULTS.maxDiffBytes);
});
test('applicable instructions only and repeated shared instructions counted per batch', async () => {
  const f = fixture({ 'one/a.js': 'x', 'two/b.js': 'x' }, { 'one/a.js': 'A'.repeat(700), 'two/b.js': 'B'.repeat(700) }, { 'AGENTS.md': 'root convention', 'one/CLAUDE.md': 'ONE ONLY', 'two/CLAUDE.md': 'TWO ONLY' });
  const evidence = await loadEvidence(f.fs, f.changes, { ...DEFAULTS, maxDiffBytes: 1500 }, signal());
  assert.equal(evidence.batches.length, 2);
  assert.match(evidence.batches[0].evidence, /ONE ONLY/); assert.doesNotMatch(evidence.batches[0].evidence, /TWO ONLY/);
  assert.match(evidence.batches[1].evidence, /TWO ONLY/); assert.match(evidence.batches[1].evidence, /root convention/);
});
test('exact UTF8 budget passes, one byte lower rejects singleton explicitly', async () => {
  const f = fixture({ 'a.js': 'x' }, { 'a.js': 'я'.repeat(200) });
  const baseline = await loadEvidence(f.fs, f.changes, DEFAULTS, signal()), size = Buffer.byteLength(baseline.evidence);
  assert.equal((await loadEvidence(f.fs, f.changes, { ...DEFAULTS, maxDiffBytes: size }, signal())).batches.length, 1);
  await assert.rejects(loadEvidence(f.fs, f.changes, { ...DEFAULTS, maxDiffBytes: size - 1 }, signal()), /одного файла/);
});
test('batch count limit fails before any reviewer runs', async () => {
  const f = fixture({ 'a.js': 'x', 'b.js': 'x' }, { 'a.js': 'A'.repeat(800), 'b.js': 'B'.repeat(800) }); let calls = 0;
  const { handler } = createHandler({}, { maxDiffBytes: 1500, maxReviewBatches: 1 }, async () => { calls++; }, { collectChanges: async () => f.changes });
  const result = await handler({ agent: f.agent, rawInput: '', signal: signal() });
  assert.equal(result.kind, 'error'); assert.equal(calls, 0); assert.match(result.text, /maxReviewBatches/);
});
test('batch lanes share concurrency three and validators receive only relevant batch', async () => {
  const f = fixture({ 'a.js': 'x', 'b.js': 'x' }, { 'a.js': 'A'.repeat(800), 'b.js': 'B'.repeat(800) });
  let running = 0, peak = 0, reviews = 0, validations = 0;
  const { handler } = createHandler({}, { maxDiffBytes: 1500, maxValidations: 1 }, async (_ctx, _agent, prompt) => {
    running++; peak = Math.max(peak, running); await Promise.resolve();
    const file = prompt.includes('Changed files: ["a.js"]') ? 'a.js' : 'b.js';
    assert.ok(!prompt.includes('Changed files: ["a.js","b.js"]'));
    const finding = { id: file, file, side: 'worktree', line: 1, title: file, category: 'bug', severity: 'high', explanation: 'reachable', evidence: 'concrete', safeToFix: false, edits: [] };
    if (prompt.includes('independent skeptical validator')) validations++; else reviews++;
    running--; return { findings: [finding], limitations: [] };
  }, { collectChanges: async () => f.changes });
  const result = await handler({ agent: f.agent, rawInput: '', signal: signal() });
  assert.equal(result.kind, 'success', result.text); assert.equal(reviews, 6); assert.equal(validations, 1); assert.equal(peak, 3); assert.match(result.text, /2 пакетов/);
});
test('untracked content is supplied and budgeted, not omitted with snapshots', async () => {
  const f = fixture({ 'new.js': 'new source\n'.repeat(100) }, {}); f.changes.untracked.add('new.js');
  const evidence = await loadEvidence(f.fs, f.changes, DEFAULTS, signal()); assert.match(evidence.evidence, /NEW FILE "new.js"/); assert.match(evidence.evidence, /100: new source/);
  await assert.rejects(loadEvidence(f.fs, f.changes, { ...DEFAULTS, maxDiffBytes: 500 }, signal()), /одного файла/);
});
test('oversized source or instruction fails before coverage can be silently skipped', async () => {
  const f = fixture({ 'a.js': 'x'.repeat(100) }, { 'a.js': '+small' });
  await assert.rejects(loadEvidence(f.fs, f.changes, { ...DEFAULTS, maxFileBytes: 50 }, signal()), /maxFileBytes/);
  const g = fixture({ 'a.js': 'x' }, { 'a.js': '+small' }, { 'AGENTS.md': 'x'.repeat(100) });
  await assert.rejects(loadEvidence(g.fs, g.changes, { ...DEFAULTS, maxFileBytes: 50 }, signal()), /maxFileBytes/);
});
test('candidate outside assigned batch is rejected rather than validated with wrong context', async () => {
  const f = fixture({ 'a.js': 'x', 'b.js': 'x' }, { 'a.js': 'A'.repeat(800), 'b.js': 'B'.repeat(800) }); let validators = 0;
  const { handler } = createHandler({}, { maxDiffBytes: 1500 }, async (_c, _a, prompt) => {
    if (prompt.includes('independent skeptical validator')) validators++;
    const assignedA = prompt.includes('Changed files: ["a.js"]');
    return { findings: [{ id: 'bad', file: assignedA ? 'b.js' : 'a.js', line: 1, category: 'bug', severity: 'high', title: 'wrong batch', explanation: 'x', evidence: 'x', safeToFix: false, edits: [] }], limitations: [] };
  }, { collectChanges: async () => f.changes });
  const result = await handler({ agent: f.agent, rawInput: '', signal: signal() });
  assert.equal(validators, 0); assert.match(result.text, /outside review scope/);
});
test('changing a per-file patch or untracked classification makes review stale', async () => {
  for (const mutate of [c => ({ ...c, fileDiffs: new Map([['a.js', 'different']]) }), c => ({ ...c, untracked: new Set(['a.js']) })]) {
    const f = fixture({ 'a.js': 'x' }, { 'a.js': '+old' }); let count = 0;
    const { handler } = createHandler({}, {}, async () => ({ findings: [], limitations: [] }), { collectChanges: async () => ++count > 2 ? mutate(f.changes) : f.changes });
    const result = await handler({ agent: f.agent, rawInput: '', signal: signal() }); assert.equal(result.kind, 'error'); assert.match(result.text, /устарели/);
  }
});
test('entire failed batch makes command incomplete instead of claiming clean success', async () => {
  const f = fixture({ 'a.js': 'x', 'b.js': 'x' }, { 'a.js': 'A'.repeat(800), 'b.js': 'B'.repeat(800) });
  const { handler } = createHandler({}, { maxDiffBytes: 1500 }, async (_c, _a, prompt) => {
    if (prompt.includes('Changed files: ["b.js"]')) throw new Error('provider failure');
    return { findings: [], limitations: [] };
  }, { collectChanges: async () => f.changes });
  const result = await handler({ agent: f.agent, rawInput: '', signal: signal() }); assert.equal(result.kind, 'error'); assert.match(result.text, /пакет не проверен/);
});
