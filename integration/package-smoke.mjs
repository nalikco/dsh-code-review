import assert from 'node:assert/strict';
import { Context } from '@deepseek-ai/cordis';
import Commands from '@deepseek-ai/dsh-commands';

const plugin = await import(process.env.PACKAGE_ENTRY);
const ctx = new Context();
const commands = ctx.plugin(Commands); while (commands.inertia) await commands.inertia; assert.equal(commands.state, 2);
const fiber = ctx.plugin(plugin); while (fiber.inertia) await fiber.inertia; assert.equal(fiber.state, 2);
const queued = [];
const agent = { id: 'packed-review', session: { append() {} }, followup: message => queued.push(message) };
const signal = new AbortController().signal;
const help = await ctx.commands.execute(agent, '/code-review --help', [], signal);
assert.equal(help.result.kind, 'success'); assert.equal(queued.length, 0);
const review = await ctx.commands.execute(agent, '/code-review --fix --focus "errors"', [], signal);
assert.equal(review.result.kind, 'success'); assert.equal(queued.length, 1);
assert.match(queued[0].content[0].text, /Mode: FIX/); assert.match(queued[0].content[0].text, /Correctness and security/);
assert.match(queued[0].content[0].text, /errors/);
await fiber.dispose(); assert.equal(ctx.commands.find(agent, 'code-review'), undefined); await commands.dispose();
console.log('Packed bundle: command-only activation, prompt handoff, help and unload OK');
