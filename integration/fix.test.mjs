import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SessionStore from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import LocalFs from '@deepseek-ai/dsh-fs-local';
import * as fsTools from '@deepseek-ai/dsh-tool-fs';
import * as observation from '@deepseek-ai/dsh-fs-observation-policy';
import { createFixScheduler } from '../fix.mjs';
import { loadEvidence } from '../workspace.mjs';
import { DEFAULTS } from '../options.mjs';
class Scripted extends LlmAdapter {
  step = 0; mode = 'normal'; started;
  async *stream(options) {
    this.started?.();
    if (this.mode === 'hang') { if (!options.signal.aborted) await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return; }
    const step = this.step++;
    const calls = this.mode === 'no-read' ? ['edit'] : this.mode === 'retry' ? ['read', 'edit', 'edit'] : ['read', 'edit'];
    const name = calls[step];
    if (!name) { yield { type: 'finish', reason: { kind: 'stop' } }; return; }
    const text = options.messages.flatMap(m => m.content ?? []).filter(b => b.type === 'text').map(b => b.text).find(text => text.includes('Untrusted validated replacement data:\n'));
    const edits = JSON.parse(text.split('Untrusted validated replacement data:\n')[1]);
    const args = name === 'read' ? { file_path: edits[0].file_path } : { ...edits[0], replace_all: false };
    const block = { type: 'tool-call', id: `fix-${step}`, name, arguments: JSON.stringify(args) };
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id: block.id, name, argumentsDelta: block.arguments };
    yield { type: 'block-end', index: 0, block }; yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}
async function setup(t, mode = 'normal') {
 const root = await mkdtemp(path.join(os.tmpdir(), 'review-fix-')); await writeFile(path.join(root, 'a.js'), 'one\n');
 const ctx = new Context(); new SystemPrompt(ctx, {}); new ToolRuntime(ctx); new SessionProjectionRegistry(ctx); new SessionStore(ctx); new AgentRegistry(ctx); new LlmRuntime(ctx); new SandboxPolicy(ctx, { mode: 'workspace-write', workspaceRoot: root }); new LocalFs(ctx, { cwd: root, diffBasisMaxBytes: 100000 });
 const toolFiber = ctx.plugin(fsTools, {}); while (toolFiber.inertia) await toolFiber.inertia; t.after(() => toolFiber.dispose());
 const observe = ctx.plugin(observation, {}); while (observe.inertia) await observe.inertia; t.after(() => observe.dispose());
 const adapter = new Scripted(); adapter.mode = mode; t.after(ctx.llm.registerAdapter(['test'], adapter));
 const loop = ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 3 }); while (loop.inertia) await loop.inertia; t.after(() => loop.dispose());
 const handle = await ctx.agents.create({ sessionId: 'fix-parent', meta: { cwd: root }, agentOptions: { provider: 'test', model: 'scripted' } }); t.after(() => handle.dispose());
 const agent = handle.agent, scheduler = createFixScheduler(ctx); t.after(scheduler.stop);
 const evidence = await loadEvidence(ctx.fs, { root, files: ['a.js'], diff: 'diff', base: 'sha', untracked: new Set() }, DEFAULTS, new AbortController().signal);
 const findings = [{ title: 'fix', safeToFix: true, edits: [{ file: 'a.js', oldString: 'one', newString: 'two' }] }];
 const schedule = () => scheduler.schedule({ agent, evidence, findings, config: DEFAULTS, signal: new AbortController().signal });
 return { root, ctx, agent, adapter, scheduler, schedule };
}
test('normal fix runs read then edit through durable tool pipeline', async t => {
 const f = await setup(t); const result = await f.schedule(); assert.deepEqual(result.queued, ['a.js']);
 await f.agent.whenIdle(); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'two\n', JSON.stringify(f.agent.session.snapshotEvents().filter(e => ['turn/end','tool/result','assistant/message'].includes(e.type))));
 const events = f.agent.session.snapshotEvents(); assert.ok(events.some(e => e.type === 'tool/call' && e.data.name === 'edit')); assert.ok(events.some(e => e.type === 'tool/result'));
 assert.equal(f.ctx.tools.guardReason({ agent: f.agent, name: 'bash', arguments: {} }), undefined, 'temporary policy removed after turn');
});
test('parent monotonic deny guard is preserved', async t => {
 const f = await setup(t); f.agent.ctx.tools.guard(exec => exec.name === 'edit' ? 'user write deny' : undefined);
 await f.schedule(); await f.agent.whenIdle(); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'one\n');
});
test('parent pre-execute risk gate is preserved', async t => {
 const f = await setup(t); let checked = false;
 f.agent.ctx.on('tools/pre-execute', (exec, next) => { if (exec.name === 'edit') { checked = true; return { kind: 'deny', reason: 'Auto risk denied' }; } return next(); });
 await f.schedule(); await f.agent.whenIdle(); assert.equal(checked, true); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'one\n');
});
test('fix cannot bypass observation read requirement', async t => {
 const f = await setup(t, 'no-read'); await f.schedule(); await f.agent.whenIdle(); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'one\n');
});
test('downstream filesystem veto remains authoritative', async t => {
 const f = await setup(t); f.ctx.on('fs/edit-intent', () => { throw new Error('filesystem veto'); }, { prepend: true });
 await f.schedule(); await f.agent.whenIdle(); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'one\n');
});
test('plan mode blocks fix before parent wake', async t => {
 const f = await setup(t); f.agent.ctx.provide('planMode', { get: () => ({ active: true }) });
 await assert.rejects(f.schedule(), /plan mode/); assert.equal(f.agent.status, 'idle');
});
test('unload cancels active fix before removing temporary guard', async t => {
 const f = await setup(t, 'hang'); const started = new Promise(resolve => { f.adapter.started = resolve; });
 await f.schedule(); await started; f.scheduler.stop(); await f.agent.whenIdle();
 assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'one\n'); assert.equal(f.agent.status, 'idle');
});
test('failure latch prevents retry after downstream veto clears', async t => {
 const f = await setup(t, 'retry'); let attempts = 0;
 f.ctx.on('fs/edit-intent', (_target, _actor, next) => { attempts++; if (attempts === 1) throw new Error('once veto'); return next(); }, { prepend: true });
 await f.schedule(); await f.agent.whenIdle(); assert.equal(attempts, 1); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'one\n');
});
test('command abort cancels already queued normal fix turn', async t => {
 const f = await setup(t, 'hang'); const started = new Promise(resolve => { f.adapter.started = resolve; }); const controller = new AbortController();
 const evidence = await loadEvidence(f.ctx.fs, { root: f.root, files: ['a.js'], diff: 'diff', untracked: new Set() }, DEFAULTS, controller.signal);
 await f.scheduler.schedule({ agent: f.agent, evidence, findings: [{ title: 'fix', safeToFix: true, edits: [{ file: 'a.js', oldString: 'one', newString: 'two' }] }], config: DEFAULTS, signal: controller.signal });
 await started; controller.abort(); await f.agent.whenIdle(); assert.equal(f.agent.status, 'idle'); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'one\n');
});
test('temporary policies close at fix turn boundary before next queued user turn', async t => {
 const f = await setup(t); let nextTurnPolicy, observed = false;
 f.ctx.on('session/event', (session, event) => { if (session === f.agent.session && event.type === 'turn/start' && event.data.turn === 2) { observed = true; nextTurnPolicy = f.ctx.tools.guardReason({ agent: f.agent, name: 'bash', arguments: {} }); } });
 await f.schedule();
 f.agent.followup((await import('@deepseek-ai/dsh-llm')).createUserMessage({ content: [{ type: 'text', text: 'Unrelated next task' }] }));
 await f.agent.whenIdle(); assert.equal(observed, true); assert.equal(nextTurnPolicy, undefined); assert.equal(f.agent.session.snapshotEvents().filter(e => e.type === 'turn/start').length, 2);
});
test('cancel after applied edit preserves durable edit result', async t => {
 const f = await setup(t);
 f.agent.ctx.on('tools/result', (exec, result) => { if (exec.name === 'edit' && !result.isError) f.agent.cancel({ kind: 'user' }); });
 await f.schedule(); await f.agent.whenIdle(); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'two\n');
 const events = f.agent.session.snapshotEvents(); const call = events.find(e => e.type === 'tool/call' && e.data.name === 'edit');
 assert.ok(call); assert.ok(events.some(e => e.type === 'tool/result' && JSON.stringify(e.data).includes('two')), JSON.stringify(events.filter(e => e.type.startsWith('tool/'))));
});
test('policy revoked after read prevents the pending edit', async t => {
 const f = await setup(t);
 f.agent.ctx.on('tools/result', (exec, result) => { if (exec.name === 'read' && !result.isError) f.agent.session.append('sandbox/mode', { mode: 'read-only' }); });
 await f.schedule(); await f.agent.whenIdle(); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'one\n');
});
test('stale proposal cannot overwrite external edit even after parent reread', async t => {
 const f = await setup(t);
 f.agent.ctx.on('tools/result', async (exec, result) => { if (exec.name === 'read' && !result.isError) await writeFile(path.join(f.root, 'a.js'), 'foreign\n'); });
 await f.schedule(); await f.agent.whenIdle(); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'foreign\n');
});
test('downstream stale observation cannot be replaced by fresh review snapshot', async t => {
 const f = await setup(t, 'no-read');
 const target = await f.ctx.fs.resolve(path.join(f.root, 'a.js'));
 f.ctx.emit('fs/observed', target, { kind: 'present', version: 'old-parent-version' }, { agent: f.agent });
 await f.schedule(); await f.agent.whenIdle(); assert.equal(await readFile(path.join(f.root, 'a.js'), 'utf8'), 'one\n');
});
test('plugin cancellation preserves unrelated queued user work', async t => {
 const f = await setup(t, 'hang'); const started = new Promise(resolve => { f.adapter.started = resolve; });
 await f.schedule(); await started;
 f.agent.followup((await import('@deepseek-ai/dsh-llm')).createUserMessage({ content: [{ type: 'text', text: 'Unrelated queued task' }] }));
 f.scheduler.stop(); await f.agent.whenIdle();
 const events = f.agent.session.snapshotEvents();
 assert.equal(events.some(e => e.type === 'agent/inbox/spliced' && e.data.outcome === 'canceled' && e.data.removedCount > 0), false);
});
