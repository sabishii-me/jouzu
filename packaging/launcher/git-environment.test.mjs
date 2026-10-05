import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const script = readFileSync(new URL('./git-environment.ps1', import.meta.url), 'utf8');

test('the Git Bash resolver uses only Jouzu-owned copies', () => {
  // A system Git is reported so the interface can offer it, and never resolved on its own: the
  // PortableGit we ship is the version this build was qualified against.
  assert.ok(script.includes('Get-SystemEnvironment'));
  assert.ok(script.includes(String.raw`Join-Path $InstallRoot 'runtime\git\installed'`));
  assert.ok(script.includes(String.raw`Join-Path $env:LOCALAPPDATA 'Shisa.ai\Jouzu\tools\git'`));
  const resolution = script.slice(script.indexOf('# The chosen source first'));
  assert.ok(resolution.length > 0, 'the resolution section is present');
  assert.ok(resolution.includes(String.raw`@($preferredInfo, $bundledInfo, $managedInfo)`));
  assert.ok(!resolution.includes('$systemInfo'), 'a detected system Git is never used implicitly');
});

test('the interface can install the bundled Git Bash and verify what it installs', () => {
  assert.ok(script.includes('[switch]$Install'));
  assert.ok(script.includes('/git-for-windows/git/releases/download/'));
  assert.ok(script.includes('Get-FileHash -LiteralPath $archive -Algorithm SHA256'));
  assert.ok(script.includes('Get-AuthenticodeSignature -LiteralPath $archive'));
  assert.ok(script.includes('Johannes Schindelin'));
  assert.ok(script.includes('Unblock-File'));
});

test('the reported state names every source and the archive', () => {
  assert.ok(script.includes('[switch]$Report'));
  for (const key of ['bundled', 'managed', 'system', 'preferred', 'archive']) {
    assert.ok(script.includes(`${key} =`), `the report carries ${key}`);
  }
});
