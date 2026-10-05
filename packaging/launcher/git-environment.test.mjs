import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const script = readFileSync(new URL('./git-environment.ps1', import.meta.url), 'utf8');

test('the Git Bash resolver prefers Jouzu copies and can use the one this PC has', () => {
  // Jouzu's own copies come first, and a Git Bash this PC already has answers a launch or an
  // installation preparation; only an installation asks for a copy of ours.
  assert.ok(script.includes('Get-SystemEnvironment'));
  assert.ok(script.includes(String.raw`Join-Path $InstallRoot 'runtime\git\installed'`));
  assert.ok(script.includes(String.raw`Join-Path $env:LOCALAPPDATA 'Shisa.ai\Jouzu\tools\git'`));
  const resolution = script.slice(script.indexOf('# The chosen source first'));
  assert.ok(resolution.length > 0, 'the resolution section is present');
  const own = resolution.indexOf(String.raw`@($bundledInfo, $managedInfo)`);
  const fallback = resolution.indexOf('if (-not $Install -and $systemInfo)');
  const gate = resolution.indexOf('if (-not ($Prepare -or $Install))');
  assert.ok(own >= 0 && fallback > own, 'our own copies are resolved before the one this PC has');
  assert.ok(gate > fallback, 'installation follows the fallback, so a copy on this PC never ends it');
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
  for (const key of ['bundled', 'managed', 'system', 'archive']) {
    assert.ok(script.includes(`${key} =`), `the report carries ${key}`);
  }
});
