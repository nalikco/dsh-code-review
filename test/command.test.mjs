import { test } from 'node:test';
import assert from 'node:assert/strict';
import { apply, inject } from '../index.mjs';
import { parseOptions } from '../options.mjs';
import { buildInvocation, skill, SKILL_NAME } from '../prompt.mjs';

function fixture() {
  const registered = [];
  apply({ skills: { register(value) { registered.push(value); } } });
  return { registered };
}
for (const [input, expected] of [
  ['', { base: null, focus: '', help: false }],
  [' --base main --focus "memory leaks"', { base: 'main', focus: 'memory leaks', help: false }],
  ["--focus 'a b' --help", { base: null, focus: 'a b', help: true }],
]) test(`parse ${input || 'default'}`, () => assert.deepEqual(parseOptions(input), expected));
for (const input of ['--fix', '--base m --base m', '--unknown', '--base', '--base -x', '--focus "x', '--base "a\nb"', '--focus \\']) test(`reject ${JSON.stringify(input)}`, () => assert.throws(() => parseOptions(input)));
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
  assert.equal(parseOptions('--focus "--help behavior"').focus, '--help behavior');
  assert.equal(parseOptions("--focus '--help'").focus, '--help');
  assert.throws(() => parseOptions('--focus --help'), /Некорректное значение/);
  assert.throws(() => parseOptions('--base "--help"'), /git ref/);
});
test('plugin registers only explicit-only native skill, no slash command', () => {
  const f = fixture(); assert.deepEqual(inject, ['skills']);
  assert.deepEqual(f.registered, [skill]); assert.equal(skill.name, SKILL_NAME); assert.deepEqual(skill.invocation, { userInvocable: true, modelInvocable: true });
});
test('fix mode is always on and parameters remain literal prompt data', () => {
  const text = buildInvocation({ base: 'main; echo unsafe', focus: 'timeout handling' });
  assert.match(text, /Mode: FIX/); assert.match(text, /Base ref \(JSON string\): "main; echo unsafe"/); assert.match(text, /timeout handling/);
  assert.match(skill.content, /does not authorize commit, push/);
});
test('session evidence bounds review, even for mixed files and a base ref', () => {
  const text = skill.content;
  assert.match(text, /specific changed lines, not merely touched file names/);
  assert.match(text, /Exclude pre-existing and concurrent changes, including other edits in the same file/);
  assert.match(text, /Session changes exist:[\s\S]*review only those attributable changes/);
  assert.match(text, /The session made no changes[\s\S]*review all staged and unstaged changes separately plus relevant untracked source files/);
  assert.match(text, /`--base` is supplied[\s\S]*merge-base of the ref and HEAD together with working-tree changes/);
  assert.match(text, /session history is unavailable or incomplete[\s\S]*do not treat uncertainty as proof of an empty session/);
  assert.match(text, /selected scope and evidence/);
});
test('review prompt does not require engine JSON output or hardcoded providers', () => {
  const text = skill.content;
  assert.doesNotMatch(text, /submit_review|structured_output|claude-opus|maxDiffBytes/);
  assert.match(text, /Respond in the user's language/);
});
test('parameter slashes cannot accidentally invoke other native skills', () => {
  const focus = 'check /other-skill and /etc/config', base = 'feature/topic';
  const text = buildInvocation({ focus, base });
  const gestures = [...text.matchAll(/(^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)(?=\s|$)/g)].map(m => m[2]);
  assert.deepEqual(gestures, []);
  assert.equal(JSON.parse(text.split('Additional focus (JSON string): ')[1].trim()), focus);
  assert.equal(JSON.parse(text.split('Base ref (JSON string): ')[1].split('\n')[0]), base);
});
