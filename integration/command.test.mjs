import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Commands from '@deepseek-ai/dsh-commands';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SessionStore from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm';
import * as plugin from '../index.mjs';

async function mount(ctx, t, plugin, config = {}) {
  const fiber = ctx.plugin(plugin, config); while (fiber.inertia) await fiber.inertia;
  assert.equal(fiber.state, 2); t.after(() => fiber.dispose()); return fiber;
}
class ScriptedAdapter extends LlmAdapter {
  requests = [];
  beforeResponse;
  async *stream(options) {
    this.requests.push(options);
    await this.beforeResponse?.(options, this.requests.length);
    yield { type: 'block-start', index: 0, blockType: 'text' };
    yield { type: 'text-delta', index: 0, text: 'Review received.' };
    yield { type: 'block-end', index: 0, block: { type: 'text', text: 'Review received.' } };
    yield { type: 'finish', reason: { kind: 'stop' } };
  }
}
async function host(t) {
  const ctx = new Context();
  for (const service of [Commands, SystemPrompt, ToolRuntime, SessionProjectionRegistry, SessionStore, AgentRegistry, LlmRuntime]) await mount(ctx, t, service);
  const adapter = new ScriptedAdapter(); t.after(ctx.llm.registerAdapter(['test'], adapter));
  await mount(ctx, t, AgentLoop, { agents: [], maxParallelToolCalls: 3 });
  const handle = await ctx.agents.create({ sessionId: 'review-parent', agentOptions: { provider: 'test', model: 'scripted' } }); t.after(() => handle.dispose());
  const fiber = await mount(ctx, t, plugin);
  return { ctx, adapter, agent: handle.agent, fiber };
}
test('command activates with only commands service and no filesystem/policy', async t => {
  const ctx = new Context(); await mount(ctx, t, Commands); const fiber = await mount(ctx, t, plugin);
  const queued = []; const agent = { followup: message => queued.push(message) };
  const definition = ctx.commands.find(agent, 'code-review'); assert.ok(definition);
  assert.equal(definition.handler({ agent, rawInput: '--fix', signal: new AbortController().signal }).kind, 'success');
  assert.equal(queued.length, 1); await fiber.dispose(); assert.equal(ctx.commands.find(agent, 'code-review'), undefined);
});
test('actual slash command delivers prompt into existing normal model turn', async t => {
  const f = await host(t); const signal = new AbortController().signal;
  assert.equal(f.ctx.get('fs'), undefined); assert.equal(f.ctx.get('sandboxPolicy'), undefined);
  const result = await f.ctx.commands.execute(f.agent, '/code-review --base main --focus "errors"', [], signal);
  assert.equal(result.result.kind, 'success'); await f.agent.whenIdle(); assert.equal(f.adapter.requests.length, 1);
  const text = f.adapter.requests[0].messages.flatMap(m => m.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  assert.match(text, /ANALYSIS ONLY/); assert.match(text, /Base ref \(JSON string\): "main"/);
  assert.equal(f.ctx.agents.list().length, 1, 'plugin itself must not create child agents');
  assert.ok(f.agent.session.snapshotEvents().some(event => event.type === 'user/message' && event.data.content.some(b => b.type === 'text' && b.text.includes('Code Review: correctness'))));
});
test('help does not model-call and unload removes slash registration', async t => {
  const f = await host(t);
  const result = await f.ctx.commands.execute(f.agent, '/code-review --help', [], new AbortController().signal);
  assert.equal(result.result.kind, 'success'); assert.equal(f.adapter.requests.length, 0);
  await f.fiber.dispose(); assert.equal(f.ctx.commands.find(f.agent, 'code-review'), undefined);
});
test('busy parent receives review in a distinct next turn without interrupt', async t => {
  const f = await host(t), started = Promise.withResolvers(), release = Promise.withResolvers();
  f.adapter.beforeResponse = async (request, count) => { if (count === 1) { started.resolve(request); await release.promise; } };
  f.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Existing task' }] }));
  const current = await started.promise;
  const result = await f.ctx.commands.execute(f.agent, '/code-review --fix', [], new AbortController().signal);
  assert.equal(result.result.kind, 'success'); assert.equal(current.signal.aborted, false); assert.equal(f.adapter.requests.length, 1);
  const firstText = current.messages.flatMap(m => m.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n'); assert.doesNotMatch(firstText, /Code Review: correctness/);
  release.resolve(); await f.agent.whenIdle(); assert.equal(f.adapter.requests.length, 2);
  const text = f.adapter.requests[1].messages.flatMap(m => m.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n'); assert.match(text, /Mode: FIX/);
  const ends = f.agent.session.snapshotEvents().filter(event => event.type === 'turn/end');
  assert.equal(ends.length, 2); assert.notEqual(ends[0].data.turn, ends[1].data.turn); assert.ok(ends.every(event => event.data.reason.kind === 'completed'));
});
test('SDK rejects pre-aborted command without queueing or model request', async t => {
  const f = await host(t), controller = new AbortController(); controller.abort(new Error('cancel before command'));
  await assert.rejects(f.ctx.commands.execute(f.agent, '/code-review --fix', [], controller.signal), /cancel before command/);
  assert.equal(f.adapter.requests.length, 0); assert.equal(f.agent.status, 'idle');
});
test('invalid input and unsupported attachment do not start an agent turn', async t => {
  const f = await host(t), signal = new AbortController().signal;
  assert.equal((await f.ctx.commands.execute(f.agent, '/code-review --invalid', [], signal)).result.kind, 'error');
  const result = await f.ctx.commands.execute(f.agent, '/code-review', [{ type: 'image', data: 'invalid', mimeType: 'image/png' }], signal);
  assert.equal(result.result.kind, 'error'); assert.match(result.result.text, /does not accept attachments/); assert.equal(f.adapter.requests.length, 0);
});
test('unloading slash command preserves accepted review and other queued work', async t => {
  const f = await host(t);
  f.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Existing task' }] }));
  await f.ctx.commands.execute(f.agent, '/code-review', [], new AbortController().signal);
  f.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Other queued task' }] }));
  await f.fiber.dispose(); await f.agent.whenIdle();
  assert.equal(f.ctx.commands.find(f.agent, 'code-review'), undefined); assert.equal(f.adapter.requests.length, 3);
  assert.equal(f.agent.session.snapshotEvents().filter(e => e.type === 'turn/end').length, 3);
});
test('normal parent tool deny remains authoritative after prompt handoff', async t => {
  const f = await host(t); let executed = false;
  f.ctx.tools.register({ name: 'probe', description: 'fixture', parameters: { type: 'object', properties: {}, additionalProperties: false }, output: { schema: { type: 'boolean' }, render: () => [] }, execute: async () => { executed = true; return true; } });
  f.agent.ctx.get('tools').guard(exec => exec.name === 'probe' ? 'parent deny' : undefined);
  await f.ctx.commands.execute(f.agent, '/code-review --fix', [], new AbortController().signal); await f.agent.whenIdle();
  const result = await f.agent.ctx.get('tools').execute({ agent: f.agent, callId: 'denied-probe', name: 'probe', arguments: {}, signal: new AbortController().signal });
  assert.equal(result.isError, true); assert.equal(executed, false);
});
test('real command preserves quoted regex and flag-leading focus in delivered prompt', async t => {
  const f = await host(t), focus = String.raw`--fix behavior for \d+ in C:\temp`;
  const result = await f.ctx.commands.execute(f.agent, `/code-review --focus "${focus}"`, [], new AbortController().signal);
  assert.equal(result.result.kind, 'success'); await f.agent.whenIdle();
  const text = f.adapter.requests[0].messages.flatMap(m => m.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n');
  assert.ok(text.includes(`Additional focus (JSON string): ${JSON.stringify(focus)}`)); assert.match(text, /ANALYSIS ONLY/);
});
