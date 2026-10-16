import { randomUUID } from 'node:crypto';
import { SessionId } from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { foldConsumedWork } from '@deepseek-ai/dsh-agent';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { setSandboxMode } from '@deepseek-ai/dsh-sandbox-policy';
import { applyChildComposition, appendDelegatedPolicyOverrides, captureDelegatedPolicyOverrides, childSessionMeta, resolveChildAgentOptions, resolveChildDepth } from '@deepseek-ai/dsh-subagent';
import { REPORT_PARAMETERS } from './findings.mjs';

const READ_TOOLS = ['read', 'glob', 'grep'];
export function reviewGuard(allowed, submitted) {
  const names = new Set([...allowed, 'submit_review']);
  return exec => {
    if (submitted()) return 'Code review already submitted.';
    if (!names.has(exec.name)) return 'Code review is read-only: this capability is not permitted.';
    if (exec.arguments?.sandbox_permissions) return 'Code review cannot escalate permissions.';
  };
}

export async function runReviewer(ctx, parent, prompt, signal) {
  signal.throwIfAborted();
  const inherited = captureDelegatedPolicyOverrides(parent);
  const depth = resolveChildDepth(parent);
  const pending = new WeakMap();
  let captured, boundary, loopError;
  const handle = await parent.ctx.agents.create({
    sessionId: SessionId(randomUUID()), parentAgent: parent,
    meta: childSessionMeta(parent, depth, false),
    agentOptions: resolveChildAgentOptions(parent, {}, depth), signal,
    setup(childCtx, child) {
      appendDelegatedPolicyOverrides(child.session, inherited);
      applyChildComposition(childCtx, parent, {});
      setSandboxMode(child.session, 'read-only');
      childCtx.tools.presentAs('native');
      const allowed = READ_TOOLS.filter(name => childCtx.tools.get(name, child) !== undefined);
      childCtx.tools.restrict({ allow: allowed });
      childCtx.tools.guard(reviewGuard(allowed, () => captured !== undefined));
      childCtx.tools.register(defineTool({
        name: 'submit_review', description: 'Submit the final structured code review exactly once. This concludes the review turn.',
        parameters: REPORT_PARAMETERS,
        output: { schema: { type: 'boolean' }, render: () => [{ type: 'text', text: 'Review recorded.' }] },
        execute(report, exec) { pending.set(exec, report); exec.concludeTurn(); return true; },
      }));
      childCtx.on('tools/result', (exec, result) => {
        const value = pending.get(exec); pending.delete(exec);
        if (value !== undefined && !result.isError) captured = value;
      });
      childCtx.on('agent/error', ({ error }) => { loopError = error; });
      boundary = child.session.seq;
    },
  });
  const child = handle.agent;
  const onAbort = () => child.cancel({ kind: 'parent' });
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    if (signal.aborted) onAbort();
    else child.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: prompt }] }));
    await child.whenIdle();
    signal.throwIfAborted();
    const { end, droppedUnrun } = foldConsumedWork(child.session.snapshotEvents(boundary));
    if (end?.data.reason.kind !== 'completed' || droppedUnrun || loopError || captured === undefined) throw new Error(`Review agent did not complete a committed report (${end?.data.reason.kind ?? 'no turn'}, ${loopError?.message ?? 'no valid submission'}).`);
    return captured;
  } finally {
    signal.removeEventListener('abort', onAbort);
    await handle.dispose();
  }
}
