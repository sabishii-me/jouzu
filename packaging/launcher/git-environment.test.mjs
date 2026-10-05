import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const script = readFileSync(new URL('./git-environment.ps1', import.meta.url), 'utf8');

test('the Git Bash resolver only accepts Jouzu-owned copies', () => {
  // A system Git of unknown age must never decide how Jouzu runs: the PortableGit we ship is the
  // version this build was qualified against.
  assert.ok(!script.includes('ProgramFiles'), 'no system installation is a candidate');
  assert.ok(!script.includes('$env:PATH'), 'PATH is not searched');
  assert.ok(script.includes(String.raw`Join-Path $InstallRoot 'runtime\git\installed'`), 'the installed PortableGit is the first candidate');
  assert.ok(script.includes(String.raw`Join-Path $env:LOCALAPPDATA 'Shisa.ai\Jouzu\tools\git'`), 'the managed location is the second candidate');
});

test('preparation verifies the archive instead of trusting whatever is present', () => {
  assert.ok(script.includes('Get-FileHash -LiteralPath $archive -Algorithm SHA256'));
  assert.ok(script.includes('Get-AuthenticodeSignature -LiteralPath $archive'));
  assert.ok(script.includes('Johannes Schindelin'));
  assert.ok(script.includes("throw 'Git Bash is unavailable. Repair the Jouzu installation.'"));
});
