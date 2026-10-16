import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, realpath } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const expected = [
  'LICENSE', 'README.md', 'README.ru.md', 'SECURITY.md', 'package.json', 'cordis.patch.yml', 'icon.svg',
  'locale/en.json', 'locale/ru.json', 'index.mjs', 'engine.mjs', 'findings.mjs', 'fix.mjs', 'git.mjs',
  'options.mjs', 'prompts.mjs', 'runner.mjs', 'workspace.mjs',
].sort();
assert.equal(manifest.private, true);
assert.equal(manifest.repository.url, 'git+https://github.com/nalikco/dsh-code-review.git');
assert.ok(!Object.keys(manifest.scripts).some(name => /^(preinstall|install|postinstall|prepare|prepack|postpack)$/u.test(name)));
const temp = await mkdtemp(path.join(os.tmpdir(), 'dsh-code-review-package-'));
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const npm = (cwd, args) => execFileSync(npmCommand, args, { cwd, encoding: 'utf8', maxBuffer: 4000000, env: { ...process.env, npm_config_ignore_scripts: 'true', npm_config_audit: 'false', npm_config_fund: 'false' } });
const [pack] = JSON.parse(npm(root, ['pack', '--json', '--ignore-scripts', '--pack-destination', temp]));
assert.deepEqual(pack.files.map(file => file.path).sort(), expected, 'Unexpected public package files');
const archive = path.join(temp, pack.filename);
const consumer = path.join(temp, 'consumer'); await mkdir(consumer);
// Resolve declared SDK dependencies in a fresh consumer. The source checkout
// uses npm ci and its lockfile; this separately checks ordinary consumer install.
await writeFile(path.join(consumer, 'package.json'), JSON.stringify({ name: 'packed-dsh-code-review-check', private: true, type: 'module', dependencies: { ...manifest.peerDependencies, ...manifest.devDependencies, [manifest.name]: archive } }));
npm(consumer, ['install', '--ignore-scripts', '--no-audit', '--no-fund']);
const entry = path.join(consumer, 'node_modules', manifest.name, 'index.mjs');
assert.ok((await realpath(entry)).startsWith((await realpath(consumer)) + path.sep), 'Packed module must not resolve to the source checkout');
const installed = JSON.parse(await readFile(path.join(consumer, 'node_modules', manifest.name, 'package.json'), 'utf8'));
assert.equal(installed.version, manifest.version);
assert.equal(installed.private, true);
const smoke = path.join(consumer, 'package-smoke.mjs'); await copyFile(path.join(root, 'integration/package-smoke.mjs'), smoke);
execFileSync(process.execPath, [smoke], { cwd: consumer, stdio: 'inherit', env: { ...process.env, PACKAGE_ENTRY: pathToFileURL(entry).href } });
const digest = createHash('sha256').update(await readFile(archive)).digest('hex');
console.log(`Packed files: ${expected.length}; fresh consumer install and SDK activation passed.`);
console.log(`Artifact: ${archive}\nSHA-256: ${digest}`);
// Keep the temporary evidence; never delete computed paths in release checks.
