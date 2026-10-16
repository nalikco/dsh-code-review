import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { HELP, parseOptions } from './options.mjs';
import { buildPrompt } from './prompt.mjs';

export const inject = ['commands'];

export function apply(ctx) {
  ctx.commands.register({
    definitionId: 'dsh-code-review/command',
    name: 'code-review',
    description: 'Review changes for correctness, reuse and efficiency. --fix asks the current agent to apply confirmed fixes.',
    input: { hint: '[--fix] [--base <ref>] [--focus "text"] [--help]' },
    handler({ agent, rawInput, signal }) {
      let options;
      try { options = parseOptions(rawInput); }
      catch (error) { return { kind: 'error', text: error.message }; }
      if (options.help) return { kind: 'success', text: HELP };
      signal.throwIfAborted();
      agent.followup(createUserMessage({ content: [{ type: 'text', text: buildPrompt(options) }], source: { kind: 'user' } }));
      return { kind: 'success', text: options.fix ? 'Review с исправлениями передан текущему агенту.' : 'Review без изменений передан текущему агенту.' };
    },
  });
}
