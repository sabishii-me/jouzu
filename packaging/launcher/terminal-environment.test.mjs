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

test('an installed Windows Terminal is preferred, and the bundled one covers machines without it', () => {
  // The order matters: the user's own terminal keeps their settings, and the bundled copy is what
  // fixes the machines whose legacy console host damages the interface.
  const resolution = script.slice(script.indexOf('foreach ($info in @($systemInfo, $bundledInfo))'));
  assert.ok(resolution.length > 0, 'the resolution order is present');
  assert.ok(resolution.indexOf('$systemInfo') < resolution.indexOf('$bundledInfo'));
});

test('the report names both sources, the effective one and the archive', () => {
  assert.ok(script.includes('[switch]$Report'));
  assert.ok(script.includes('[switch]$Install'));
  for (const key of ['bundled =', 'system =', 'effective =', 'archive =']) {
    assert.ok(script.includes(key), `the report carries ${key}`);
  }
});
