import { Context } from '@deepseek-ai/cordis';
import SystemPrompt from '@deepseek-ai/dsh-system-prompt';
import ToolRuntime from '@deepseek-ai/dsh-tools';
import SessionProjectionRegistry from '@deepseek-ai/dsh-session-projection';
import SessionStore from '@deepseek-ai/dsh-session';
import AgentRegistry from '@deepseek-ai/dsh-agent';
import LlmRuntime from '@deepseek-ai/dsh-llm';
import SandboxPolicy from '@deepseek-ai/dsh-sandbox-policy';
import Commands from '@deepseek-ai/dsh-commands';
import LocalFs from '@deepseek-ai/dsh-fs-local';

// Mirror real DSH: service providers are plugin fibers, not permissive root
// constructor instances. Agent-loop inject does not include fs/sandboxPolicy.
export async function createHost(t, cwd = '/tmp') {
  const ctx = new Context();
  for (const [plugin, config] of [
    [SystemPrompt, {}], [ToolRuntime, {}], [SessionProjectionRegistry, {}],
    [SessionStore, {}], [AgentRegistry, {}], [LlmRuntime, {}],
    [SandboxPolicy, { mode: 'workspace-write', workspaceRoot: cwd }],
    [Commands, {}], [LocalFs, { cwd, diffBasisMaxBytes: 100000 }],
  ]) {
    const fiber = ctx.plugin(plugin, config);
    while (fiber.inertia) await fiber.inertia;
    if (fiber.state !== 2) throw new Error(`SDK host service did not activate: ${plugin.name}, state ${fiber.state}`);
    t.after(() => fiber.dispose());
  }
  return ctx;
}
