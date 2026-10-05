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

test("the Windows Terminal resolver takes the chosen copy, then the bundled one, then this PC's", () => {
  // The chosen copy comes first, a terminal this PC has answers a launch or a preparation, and only
  // an installation asks for a copy of ours.
  const resolution = script.slice(script.indexOf('foreach ($info in @($bundledInfo))'));
  assert.ok(resolution.length > 0, 'the resolution order is present');
  // Windows 10 replaces the console host with the copy Jouzu ships, which is why the fallback skips it there.
  const fallback = resolution.indexOf('if ($systemInfo -and -not (Test-LegacyConsole))');
  const gate = resolution.indexOf('if (-not ($Prepare -or $Install))');
  assert.ok(fallback > 0 && gate > fallback, 'a terminal on this PC never ends an installation');
});

test('the report names both sources, the effective one and the archive', () => {
  assert.ok(script.includes('[switch]$Report'));
  assert.ok(script.includes('[switch]$Install'));
  for (const key of ['bundled =', 'system =', 'effective =', 'archive =']) {
    assert.ok(script.includes(key), `the report carries ${key}`);
  }
});
