import { readFileSync } from 'node:fs';

const instructions = readFileSync(new URL('./REVIEW_PROMPT.md', import.meta.url), 'utf8');

export function buildPrompt(options) {
  return `${instructions}\n## Selected request\n\nMode: ${options.fix ? 'FIX. Review first, then apply confirmed fixes using ordinary session tools.' : 'ANALYSIS ONLY. Do not edit source files.'}\nBase ref (JSON string): ${JSON.stringify(options.base)}\nAdditional focus (JSON string): ${JSON.stringify(options.focus)}\n`;
}
