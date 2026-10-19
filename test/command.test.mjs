import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject } from '../index.mjs';
import { parseOptions, HELP } from '../options.mjs';
import { buildInvocation, skill, SKILL_NAME } from '../prompt.mjs';

function fixture() {
  let definition; const messages = [], registered = [];
  apply({ commands: { register(value) { definition = value; } }, skills: { register(value) { registered.push(value); } } });
  const agent = { followup(message) { messages.push(message); } };
  const invoke = (rawInput = '', signal = new AbortController().signal) => definition.handler({ agent, rawInput, signal });
  return { definition, messages, invoke, registered };
}
for (const [input, expected] of [
  ['', { fix: false, base: null, focus: '', help: false }],
  [' --fix --base main --focus "memory leaks"', { fix: true, base: 'main', focus: 'memory leaks', help: false }],
  ["--focus 'a b' --help", { fix: false, base: null, focus: 'a b', help: true }],
]) test(`parse ${input || 'default'}`, () => assert.deepEqual(parseOptions(input), expected));
for (const input of ['--fix --fix', '--unknown', '--base', '--base -x', '--focus "x', '--base "a\nb"', '--focus \\']) test(`reject ${JSON.stringify(input)}`, () => assert.throws(() => parseOptions(input)));
test('quoted and unquoted focus preserve literal regex/path backslashes', () => {
  const value = String.raw`regex \d+ and C:\temp`;
  assert.equal(parseOptions(`--focus "${value}"`).focus, value);
  assert.equal(parseOptions(`--focus '${value}'`).focus, value);
  assert.equal(parseOptions(String.raw`--focus \d+`).focus, String.raw`\d+`);
});
test('escapes handle quotes, spaces and doubled backslashes without shell expansion', () => {
  assert.equal(parseOptions(String.raw`--focus "a \"quote\" and \\ slash"`).focus, 'a "quote" and \\ slash');
  assert.equal(parseOptions(String.raw`--focus a\ b`).focus, 'a b');
  assert.equal(parseOptions('--focus "$(echo test)"').focus, '$(echo test)');
});
test('explicitly quoted focus may start with flags, missing bare values still fail', () => {
  assert.equal(parseOptions('--focus "--fix behavior"').focus, '--fix behavior');
  assert.equal(parseOptions("--focus '--help'").focus, '--help');
  assert.throws(() => parseOptions('--focus --fix'), /Некорректное значение/);
  assert.throws(() => parseOptions('--base "--help"'), /git ref/);
});
test('plugin registers command and explicit-only native skill', () => {
  const f = fixture(); assert.deepEqual(inject, ['commands', 'skills']); assert.equal(f.definition.name, 'code-review');
  assert.deepEqual(f.registered, [skill]); assert.equal(skill.name, SKILL_NAME); assert.deepEqual(skill.invocation, { userInvocable: true, modelInvocable: false });
});
test('default queues full skill instructions with skill-invocation source, nothing attributed to the user', () => {
  const f = fixture(), result = f.invoke(); assert.equal(result.kind, 'success'); assert.equal(f.messages.length, 1);
  const message = f.messages[0], text = message.content[0].text;
  assert.equal(message.role, 'user');
  assert.deepEqual(message.source, { kind: 'skill-invocation', name: SKILL_NAME, form: 'instructions' });
  assert.match(text, /^<skill_content name="dsh-code-review">/); assert.match(text, /ANALYSIS ONLY/);
  assert.match(text, /Correctness and security|Reuse and code quality/); assert.match(text, /three independent read-only reviews in parallel/);
});
test('fix is explicit and parameters remain literal prompt data', () => {
  const f = fixture(); f.invoke('--fix --base "main; echo unsafe" --focus "timeout handling"');
  const text = f.messages[0].content[0].text;
  assert.match(text, /Mode: FIX/); assert.match(text, /Base ref \(JSON string\): "main; echo unsafe"/); assert.match(text, /timeout handling/);
  assert.match(skill.content, /not authorization for commit, push/);
});
test('help and invalid input do not wake model', () => {
  const f = fixture(); assert.equal(f.invoke('--help').text, HELP); assert.equal(f.invoke('--typo').kind, 'error'); assert.equal(f.messages.length, 0);
});
test('aborted invocation does not enqueue anything', () => {
  const f = fixture(), controller = new AbortController(); controller.abort(new Error('cancelled'));
  assert.throws(() => f.invoke('', controller.signal), /cancelled/); assert.equal(f.messages.length, 0);
});
test('review prompt does not require engine JSON output or hardcoded providers', () => {
  const text = skill.content;
  assert.doesNotMatch(text, /submit_review|structured_output|claude-opus|maxDiffBytes/);
  assert.match(text, /Respond in the user's language/);
});
test('parameter slashes cannot accidentally invoke other native skills', () => {
  const focus = 'check /other-skill and /etc/config', base = 'feature/topic';
  const text = buildInvocation({ fix: false, focus, base });
  const gestures = [...text.matchAll(/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g)].map(m => m[2]);
  assert.deepEqual(gestures, []);
  assert.equal(JSON.parse(text.split('Additional focus (JSON string): ')[1].trim()), focus);
  assert.equal(JSON.parse(text.split('Base ref (JSON string): ')[1].split('\n')[0]), base);
});
