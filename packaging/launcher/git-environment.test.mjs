import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const script = readFileSync(new URL('./git-environment.ps1', import.meta.url), 'utf8');

test('the Git Bash resolver installs Jouzu copies and only launches with the one this PC has', () => {
  // Preparing an installation and installing ask for a copy of Jouzu's, so a Git Bash this PC already
  // has is only the answer when Jouzu's own copies are absent and nothing was asked for.
  assert.ok(script.includes('Get-SystemEnvironment'));
  assert.ok(script.includes(String.raw`Join-Path $InstallRoot 'runtime\git\installed'`));
  assert.ok(script.includes(String.raw`Join-Path $env:LOCALAPPDATA 'Shisa.ai\Jouzu\tools\git'`));
  const own = script.indexOf(String.raw`@($bundledInfo, $managedInfo)`);
  const gate = script.indexOf('if (-not ($Prepare -or $Install))');
  const system = script.indexOf('if ($systemInfo)');
  assert.ok(own > 0 && gate > own, "Jouzu's own copies are resolved first");
  assert.ok(gate > 0 && script.indexOf('if ($systemInfo)', gate) > gate, 'a copy this PC has never answers an installation or a preparation');
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
