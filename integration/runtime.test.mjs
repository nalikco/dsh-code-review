import { test } from 'node:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SessionStore from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime, { LlmAdapter } from '@deepseek-ai/dsh-llm';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Commands from '@deepseek-ai/dsh-commands';
import LocalFs from '@deepseek-ai/dsh-fs-local';
import * as plugin from '../index.mjs';
import { runReviewer, reviewGuard } from '../runner.mjs';

class ScriptedAdapter extends LlmAdapter {
  requests = []; counts = new Map(); mode = 'success';
  async *stream(options) {
    this.requests.push(options);
    this.started?.();
    const key = options.sessionId;
    const n = this.counts.get(key) ?? 0; this.counts.set(key, n + 1);
    if (this.mode === 'plain') {
      yield { type: 'block-start', index: 0, blockType: 'text' };
      yield { type: 'text-delta', index: 0, text: 'No issues' };
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'No issues' } };
      yield { type: 'finish', reason: { kind: 'stop' } }; return;
    }
    if (this.mode === 'hang') { await new Promise(resolve => options.signal.addEventListener('abort', resolve, { once: true })); return; }
    const name = this.mode === 'attack' && n === 0 ? 'write' : 'submit_review';
    const block = { type: 'tool-call', id: `call-${n}`, name, arguments: JSON.stringify(name === 'submit_review' ? { findings: [], limitations: [] } : {}) };
    yield { type: 'block-start', index: 0, blockType: 'tool-call' };
    yield { type: 'tool-call-delta', index: 0, id: block.id, name, argumentsDelta: block.arguments };
    yield { type: 'block-end', index: 0, block };
    yield { type: 'finish', reason: { kind: 'tool-calls' } };
  }
}
async function setup(t, mode = 'success', withRead = false) {
  const ctx = new Context();
  new SystemPrompt(ctx, {}); new ToolRuntime(ctx); new SessionProjectionRegistry(ctx); new SessionStore(ctx); new AgentRegistry(ctx); new LlmRuntime(ctx);
  new SandboxPolicy(ctx, { mode: 'workspace-write', workspaceRoot: '/tmp' });
  new Commands(ctx); new LocalFs(ctx, { cwd: '/tmp', diffBasisMaxBytes: 100000 });
  const adapter = new ScriptedAdapter(); adapter.mode = mode;
  const remove = ctx.llm.registerAdapter(['test'], adapter); t.after(remove);
  let writes = 0;
  if (withRead) ctx.tools.register({ name: 'read', description: 'read fixture', parameters: { type: 'object', properties: {}, additionalProperties: false }, output: { schema: { type: 'string' }, render: (_a, text) => [{ type: 'text', text }] }, execute: async () => 'source context' });
  ctx.tools.register({ name: 'write', description: 'forbidden write fixture', parameters: { type: 'object', properties: {}, additionalProperties: false }, output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'written' }] }, execute: async () => { writes++; return true; } });
  const loop = ctx.plugin(AgentLoop, { agents: [], maxParallelToolCalls: 10 }); while (loop.inertia) await loop.inertia; assert.equal(loop.state, 2); t.after(() => loop.dispose());
  const handle = await ctx.agents.create({ sessionId: 'parent-' + Math.random(), meta: { cwd: '/tmp' }, agentOptions: { provider: 'test', model: 'scripted' } }); t.after(() => handle.dispose());
  return { ctx, adapter, parent: handle.agent, parentHandle: handle, writes: () => writes };
}
test('plugin activates against actual SDK and command registers/unregisters', async t => {
  const { ctx, parent } = await setup(t);
  const fiber = ctx.plugin(plugin, {}); while (fiber.inertia) await fiber.inertia; assert.equal(fiber.state, 2);
  assert.ok(ctx.commands.find(parent, 'code-review'));
  const result = await ctx.commands.execute(parent, '/code-review --help', [], new AbortController().signal);
  assert.equal(result.result.kind, 'success'); assert.match(result.result.text, /--fix/);
  await fiber.dispose(); assert.equal(ctx.commands.find(parent, 'code-review'), undefined);
});
test('real loop commits structured report and disposes child', async t => {
  const { ctx, parent, adapter } = await setup(t);
  const report = await runReviewer(ctx, parent, 'Call submit_review with empty findings and limitations.', new AbortController().signal);
  assert.deepEqual(report, { findings: [], limitations: [] });
  assert.equal(adapter.requests.length, 1);
  assert.deepEqual(adapter.requests[0].tools.map(t => t.name), ['submit_review']);
  assert.equal(ctx.agents.list().length, 1);
  assert.equal(parent.ctx.sandboxPolicy.resolve({ session: parent.session }).mode, 'workspace-write');
});
test('model cannot execute a denied write even when it names it directly', async t => {
  const { ctx, parent, writes } = await setup(t, 'attack');
  const report = await runReviewer(ctx, parent, 'Review', new AbortController().signal);
  assert.deepEqual(report.findings, []); assert.equal(writes(), 0); assert.equal(ctx.agents.list().length, 1);
});
test('plain no-issues prose without committed submission is a failure', async t => {
  const { ctx, parent } = await setup(t, 'plain');
  await assert.rejects(runReviewer(ctx, parent, 'Review', new AbortController().signal), /committed report/);
  assert.equal(ctx.agents.list().length, 1);
});
test('post-policy failure of submit_review does not count as a report', async t => {
  const { ctx, parent } = await setup(t);
  const off = ctx.on('tools/post-execute', (exec, result, next) => exec.name === 'submit_review' ? { kind: 'block', reason: 'fixture policy rejection' } : next()); t.after(off);
  const controller = new AbortController();
  ctx.on('tools/result', (exec, result) => { if (exec.name === 'submit_review' && result.isError) controller.abort(); });
  await assert.rejects(runReviewer(ctx, parent, 'Review', controller.signal));
  assert.equal(ctx.agents.list().length, 1);
});
test('guard denies late local writes, run_code, MCP and escalation', () => {
  const guard = reviewGuard(['read'], () => false);
  for (const name of ['write', 'run_code', 'bash', 'mcp__anything', 'subagent', 'late_local_write']) assert.ok(guard({ name, arguments: {} }));
  assert.ok(guard({ name: 'read', arguments: { sandbox_permissions: 'danger-full-access' } }));
  assert.equal(guard({ name: 'read', arguments: {} }), undefined);
  assert.ok(reviewGuard([], () => true)({ name: 'submit_review' }));
});
test('disposing parent cancels and drains an active reviewer without command abort', { timeout: 5000 }, async t => {
  const { ctx, parent, parentHandle, adapter } = await setup(t, 'hang');
  const started = new Promise(resolve => { adapter.started = resolve; });
  const pending = runReviewer(ctx, parent, 'Review', new AbortController().signal);
  const rejection = assert.rejects(pending);
  await started;
  await parentHandle.dispose();
  await rejection;
  assert.equal(ctx.agents.list().length, 0);
});
test('read capability remains visible while writes stay hidden', async t => {
  const { ctx, parent, adapter } = await setup(t, 'success', true);
  await runReviewer(ctx, parent, 'Review', new AbortController().signal);
  assert.deepEqual(adapter.requests[0].tools.map(t => t.name).sort(), ['read', 'submit_review']);
});
test('actual command dispatch drives three reviewers over real repository', async t => {
  const { ctx, adapter } = await setup(t, 'success', true);
  const root = await mkdtemp(path.join(os.tmpdir(), 'review-command-'));
  const git = (...args) => execFileSync('git', args, { cwd: root });
  git('init', '-q'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.invalid');
  await writeFile(path.join(root, 'a.js'), 'old\n'); git('add', 'a.js'); git('commit', '-qm', 'initial');
  await writeFile(path.join(root, 'a.js'), 'new\n');
  const handle = await ctx.agents.create({ sessionId: 'command-repo', meta: { cwd: root }, agentOptions: { provider: 'test', model: 'scripted' } }); t.after(() => handle.dispose());
  const fiber = ctx.plugin(plugin, {}); while (fiber.inertia) await fiber.inertia; t.after(() => fiber.dispose());
  const execution = await ctx.commands.execute(handle.agent, '/code-review', [], new AbortController().signal);
  assert.equal(execution.result.kind, 'success', execution.result.text);
  assert.match(execution.result.text, /не найдено/);
  assert.equal(adapter.requests.length, 3);
  assert.equal(ctx.agents.list().length, 2);
});
