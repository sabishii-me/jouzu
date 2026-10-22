import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { PNPM_VERSION } from './prepare-starter.mjs';
import { NODE_VERSION } from './runtime-requirements.mjs';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');

test('launcher builders and installed-update requirements use the same qualified Node and pnpm', () => {
 const bundle = read('./prepare-windows-bundle.ps1');
 assert.ok(bundle.includes(`$nodeVersion = '${NODE_VERSION}'`));
 assert.ok(bundle.includes(`$pnpmMetadata.version -ne '${PNPM_VERSION}'`));
 // Windows x64 ZIP: https://nodejs.org/dist/v24.22.1/SHASUMS256.txt
 assert.ok(bundle.includes("$nodeDigest = 'd2046d28c2c3dcd211ac5145c0bf30e2047ef9dfb306693c8c6e2eccd8b95fa5'"));
 assert.match(bundle, /\$record\[0\].*-ne \$nodeDigest/);
 assert.match(bundle, /Get-FileHash.*-ne \$nodeDigest/);
 for (const name of ['launcher-checks', 'launcher-feed-guard', 'launcher-recipe', 'launcher-runtime']) {
  const workflow = read(`../../.github/workflows/${name}.yml`);
  const pins = [...workflow.matchAll(/node-version: '([^']+)'/g)].map(match => match[1]);
  assert.ok(pins.length > 0, name);
  assert.deepEqual([...new Set(pins)], [NODE_VERSION], name);
  if (['launcher-recipe', 'launcher-runtime'].includes(name)) assert.ok(workflow.includes(`pnpm@${PNPM_VERSION} --ignore-scripts`), name);
 }
});

test('bundled and downloaded PortableGit use the same stable release and SHA-256', () => {
 const url = 'https://github.com/git-for-windows/git/releases/download/v2.56.0.windows.2/PortableGit-2.56.0.2-64-bit.7z.exe';
 const digest = '075e158ef8e1f0ab80b347e245405d3eca735c2dc88fd8e032e137d0ca61f61b';
 for (const name of ['prepare-windows-bundle.ps1', 'git-environment.ps1']) {
  const script = read(name);
  assert.ok(script.includes(url), name);
  assert.ok(script.includes(digest), name);
 }
 const git = read('./git-environment.ps1');
 assert.match(git, /Get-AuthenticodeSignature -LiteralPath \$archive/);
 assert.match(git, /CN=Johannes Schindelin/);
 assert.match(git, /\$preparedInfo\.git -ne 'git version 2\.56\.0\.windows\.2'/);
});

test('Terminal remains on the qualified stable archive in build and install paths', () => {
 for (const name of ['prepare-windows-bundle.ps1', 'terminal-environment.ps1']) {
  const script = read(name);
  assert.ok(script.includes("'1.25.2733.0'"));
  assert.ok(script.includes('bf3ef2012f6c44d8340a4c58125acc9498d19b580f9890dc043cdf831852e796'));
 }
});

test('only the full installer carries and prepares runtime components', () => {
 const bundle = read('./finalize-windows-bundle.ps1');
 assert.match(bundle, /if \(\$Full\) \{ \$resources\["\$inputRoot\/app\/"\]='app\/'; \$resources\["\$inputRoot\/runtime\/"\]='runtime\/' \}/);
 const hooks = read('./installer-hooks.nsh');
 const fullOnly = hooks.match(/!macro NSIS_HOOK_POSTINSTALL\s+!if \$\{JOUZU_LAUNCHER_ONLY\} == 0([\s\S]*?)!endif/);
 assert.ok(fullOnly, 'component preparation must be compile-time guarded');
 assert.match(fullOnly[1], /git-environment\.ps1.*-Prepare/);
 assert.match(fullOnly[1], /terminal-environment\.ps1.*-Prepare/);
 // /UPDATE bypasses uninstall, which is what preserves selected app slots and user data.
 const installer = read('./installer.nsi');
 assert.match(installer, /\$UpdateMode = 1\s+Goto reinst_done/);
 assert.match(hooks, /-RefuseActiveSessions -InstallRoot/);
});
