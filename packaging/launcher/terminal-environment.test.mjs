import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const script = readFileSync(new URL('./terminal-environment.ps1', import.meta.url), 'utf8');
const bundle = readFileSync(new URL('./prepare-windows-bundle.ps1', import.meta.url), 'utf8');

test('the terminal component pins the release it bundles and verifies it', () => {
  const url = 'https://github.com/microsoft/terminal/releases/download/v';
  assert.ok(script.includes(url));
  assert.ok(script.includes('Microsoft.WindowsTerminal_${version}_x64.zip'));
  assert.ok(bundle.includes(url));
  assert.ok(script.includes('bf3ef2012f6c44d8340a4c58125acc9498d19b580f9890dc043cdf831852e796'));
  assert.ok(bundle.includes('bf3ef2012f6c44d8340a4c58125acc9498d19b580f9890dc043cdf831852e796'));
  assert.ok(script.includes('Get-FileHash -LiteralPath $archive -Algorithm SHA256'));
  assert.ok(script.includes('Unblock-File'));
});

test("the Windows Terminal resolver installs Jouzu's copy and only launches with this PC's", () => {
  const resolution = script.slice(script.indexOf('foreach ($info in @($bundledInfo))'));
  assert.ok(resolution.length > 0, 'the resolution order is present');
  const gate = resolution.indexOf('if (-not ($Prepare -or $Install))');
  const system = resolution.indexOf('if ($systemInfo)');
  assert.ok(gate > 0 && system > gate, 'a terminal on this PC never ends an installation');
});

test('the report names both sources, the effective one and the archive', () => {
  assert.ok(script.includes('[switch]$Report'));
  assert.ok(script.includes('[switch]$Install'));
  for (const key of ['bundled =', 'system =', 'effective =', 'archive =']) {
    assert.ok(script.includes(key), `the report carries ${key}`);
  }
});
