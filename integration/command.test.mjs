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
  async *stream(options) {
    this.requests.push(options);
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
test('busy parent receives review as queued normal followup, without interrupt', async t => {
  const f = await host(t);
  f.agent.followup(createUserMessage({ content: [{ type: 'text', text: 'Existing task' }] }));
  const result = await f.ctx.commands.execute(f.agent, '/code-review --fix', [], new AbortController().signal);
  assert.equal(result.result.kind, 'success'); await f.agent.whenIdle(); assert.equal(f.adapter.requests.length, 2);
  const text = f.adapter.requests[1].messages.flatMap(m => m.content ?? []).filter(b => b.type === 'text').map(b => b.text).join('\n'); assert.match(text, /Mode: FIX/);
});
