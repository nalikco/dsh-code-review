import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Commands from '@deepseek-ai/dsh-commands';
import Skills from '@deepseek-ai/dsh-skill';

const plugin = await import(process.env.PACKAGE_ENTRY);
const ctx = new Context(), fibers = [];
for (const component of [Commands, Skills, plugin]) {
  const fiber = ctx.plugin(component); while (fiber.inertia) await fiber.inertia; assert.equal(fiber.state, 2); fibers.push(fiber);
}
const queued = [];
const agent = { id: 'packed-review', session: { append() {} }, followup: message => queued.push(message) };
const signal = new AbortController().signal;
const help = await ctx.commands.execute(agent, '/code-review --help', [], signal);
assert.equal(help.result.kind, 'success'); assert.equal(queued.length, 0);
const review = await ctx.commands.execute(agent, '/code-review --fix --focus "errors"', [], signal);
assert.equal(review.result.kind, 'success'); assert.equal(queued.length, 1);
assert.match(queued[0].content[0].text, /^\/dsh-code-review\n/); assert.match(queued[0].content[0].text, /Mode: FIX/);
assert.doesNotMatch(queued[0].content[0].text, /Correctness and security/);
const skill = await ctx.skills.get('dsh-code-review'); assert.ok(skill); assert.match(skill.content, /Correctness and security/);
assert.deepEqual(skill.invocation, { userInvocable: true, modelInvocable: false });
await fibers.pop().dispose(); assert.equal(ctx.commands.find(agent, 'code-review'), undefined); assert.equal(await ctx.skills.get('dsh-code-review'), undefined);
for (const fiber of fibers.reverse()) await fiber.dispose();
console.log('Packed bundle: native skill registration, short invocation, help and unload OK');
