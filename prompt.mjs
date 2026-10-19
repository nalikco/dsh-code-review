import { readFileSync } from 'node:fs';
import { renderSkillContent } from '@deepseek-ai/dsh-skill';

export const SKILL_NAME = 'code-review';
export const skill = {
  name: SKILL_NAME,
  provider: 'dsh-code-review',
  description: 'Review changes for correctness, reuse and efficiency; optionally apply confirmed fixes.',
  content: readFileSync(new URL('./REVIEW_PROMPT.md', import.meta.url), 'utf8'),
  source: 'dsh-code-review',
  invocation: { userInvocable: true, modelInvocable: true },
};

// The queued invocation is marked skill-invocation and carries the full
// rendered instructions itself, exactly like the native dsh-tool-skill
// injections. Nothing is attributed to the user, and the gesture scanner
// (which reads only `user`-sourced messages) is not involved, so parameter
// text cannot load any skill. Parameters stay literal JSON data; slashes are
// escaped as \u002f so copied invocation text cannot forge /name gestures.
const parameter = value => JSON.stringify(value).replaceAll('/', '\\u002f');
export function invocationSource() {
  return { kind: 'skill-invocation', name: SKILL_NAME, form: 'instructions' };
}
export function buildInvocation(options) {
  return `${renderSkillContent(skill)}
Invocation parameters:
Mode: ${options.fix ? 'FIX. Review first, then apply confirmed fixes using ordinary session tools.' : 'ANALYSIS ONLY. Do not edit source files.'}
Base ref (JSON string): ${parameter(options.base)}
Additional focus (JSON string): ${parameter(options.focus)}
`;
}
