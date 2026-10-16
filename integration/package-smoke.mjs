// Run from a packed consumer with SDK node_modules in this script's directory.
import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SessionStore from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import AgentLoop from '@deepseek-ai/dsh-agent-loop';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Commands from '@deepseek-ai/dsh-commands';
import LocalFs from '@deepseek-ai/dsh-fs-local';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
const plugin = await import(process.env.PACKAGE_ENTRY);
const ctx = new Context(), fibers = [];
const mount = async (plugin, config = {}) => { const fiber = ctx.plugin(plugin, config); while (fiber.inertia) await fiber.inertia; assert.equal(fiber.state, 2); fibers.push(fiber); return fiber; };
const root = await mkdtemp(path.join(os.tmpdir(), 'packed-review-git-'));
const git = (...args) => execFileSync('git', args, { cwd: root });
git('init', '-q');
await writeFile(path.join(root, 'untracked.js'), 'const value = 1;\n');
for (const [service, config] of [[SystemPrompt, {}], [ToolRuntime, {}], [SessionProjectionRegistry, {}], [SessionStore, {}], [AgentRegistry, {}], [LlmRuntime, {}], [SandboxPolicy, { mode: 'read-only', workspaceRoot: root }], [Commands, {}], [LocalFs, { cwd: root, diffBasisMaxBytes: 100000 }]]) await mount(service, config);
const loop = await mount(AgentLoop, { agents: [], maxParallelToolCalls: 3 });
const fiber = await mount(plugin);
const handle = await ctx.agents.create({ sessionId: 'packed-smoke', meta: { cwd: root }, agentOptions: { provider: 'fixture', model: 'unused' } });
assert.throws(() => handle.agent.ctx.fs, /without inject/);
const execution = await ctx.commands.execute(handle.agent, '/code-review --help', [], new AbortController().signal);
assert.equal(execution.result.kind, 'success'); assert.match(execution.result.text, /--fix/);
// No model adapter: still exercise actual evidence collection before the expected
// lane failures. An injection error would stop before rendering the review report.
const review = await ctx.commands.execute(handle.agent, '/code-review', [], new AbortController().signal);
assert.equal(review.result.kind, 'error'); assert.match(review.result.text, /## Code review/); assert.doesNotMatch(review.result.text, /without inject/);
await fiber.dispose(); assert.equal(ctx.commands.find(handle.agent, 'code-review'), undefined);
await handle.dispose();
for (const item of fibers.reverse()) await item.dispose();
console.log('Packed bundle: plugin-fiber activation, evidence collection, help and unload OK');
