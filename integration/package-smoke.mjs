import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Skills from '@deepseek-ai/dsh-skill';

const plugin = await import(process.env.PACKAGE_ENTRY);
const ctx = new Context(), fibers = [];
for (const component of [Skills, plugin]) {
  const fiber = ctx.plugin(component); while (fiber.inertia) await fiber.inertia; assert.equal(fiber.state, 2); fibers.push(fiber);
}
const skill = await ctx.skills.get('code-review'); assert.ok(skill); assert.match(skill.content, /Correctness and security/);
assert.deepEqual(skill.invocation, { userInvocable: true, modelInvocable: true });
await fibers.pop().dispose(); assert.equal(await ctx.skills.get('code-review'), undefined);
for (const fiber of fibers.reverse()) await fiber.dispose();
console.log('Packed bundle: native skill registration, unload OK');
