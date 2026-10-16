import z from '@deepseek-ai/schemastery';
import { createHandler } from './engine.mjs';
import { DEFAULTS } from './options.mjs';
import { runReviewer } from './runner.mjs';
import { createFixScheduler } from './fix.mjs';

export const inject = ['commands', 'agents', 'tools', 'systemPrompt', 'fs', 'sandboxPolicy'];
export const Config = z.object(Object.fromEntries(Object.entries(DEFAULTS).map(([key, value]) => [key, z.number().min(1).max(value * 4).step(1).default(value)])));
export function apply(ctx, config = {}) {
  const fixes = createFixScheduler(ctx);
  const { handler, stop } = createHandler(ctx, config, runReviewer, { scheduleFix: fixes.schedule });
  ctx.effect(() => {
    const dispose = ctx.commands.register({
      definitionId: 'dsh-code-review/command', name: 'code-review',
      description: 'Review correctness, reuse and efficiency. Read-only by default; --fix applies validated literal replacements.',
      input: { hint: '[--fix] [--base <ref>] [--focus "text"] [--help]' }, handler,
    });
    return () => { stop(); fixes.stop(); dispose(); };
  });
}
