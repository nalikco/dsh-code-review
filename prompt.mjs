import { readFileSync } from 'node:fs';

export const SKILL_NAME = 'dsh-code-review';
export const skill = {
  name: SKILL_NAME,
  description: 'Review changes for correctness, reuse and efficiency; optionally apply confirmed fixes.',
  content: readFileSync(new URL('./REVIEW_PROMPT.md', import.meta.url), 'utf8'),
  source: 'dsh-code-review',
  invocation: { userInvocable: true, modelInvocable: false },
};

// The native gesture scanner examines every text block. Escape slashes in
// parameter JSON so a focus such as "/another-skill" cannot invoke that skill.
const parameter = value => JSON.stringify(value).replaceAll('/', '\\u002f');
export function buildInvocation(options) {
  return `/${SKILL_NAME}\nUse the injected skill instructions; if they are missing, stop and report the unavailable skill.\nMode: ${options.fix ? 'FIX. Review first, then apply confirmed fixes using ordinary session tools.' : 'ANALYSIS ONLY. Do not edit source files.'}\nBase ref (JSON string): ${parameter(options.base)}\nAdditional focus (JSON string): ${parameter(options.focus)}\n`;
}
