import { skill } from './prompt.mjs';

export const inject = ['skills'];

export function apply(ctx) {
  ctx.skills.register(skill);
}
