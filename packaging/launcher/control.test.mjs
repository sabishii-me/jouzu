import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./control.mjs', import.meta.url), 'utf8');
test('provider mutations use Pi credential and settings operations', () => {
  assert.match(source, /auth\.modify\(request\.provider/);
  assert.match(source, /auth\.delete\(request\.provider/);
  assert.match(source, /settings\.setDefaultModelAndProvider/);
  assert.match(source, /await settings\.flush/);
  assert.match(source, /credentials: await auth\.list\(\)/);
  assert.doesNotMatch(source, /console\.log\(.*request/);
});
