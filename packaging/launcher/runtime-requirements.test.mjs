import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertUpdateRuntime, NODE_VERSION, RUNTIME_REPAIR_CODE } from './runtime-requirements.mjs';
import { PNPM_VERSION } from './prepare-starter.mjs';

function fixture(t, version = PNPM_VERSION) {
 const runtime = mkdtempSync(join(tmpdir(), 'jouzu-runtime-requirements-'));
 t.after(() => rmSync(runtime, { recursive: true, force: true }));
 mkdirSync(join(runtime, 'pnpm/bin'), { recursive: true });
 writeFileSync(join(runtime, 'pnpm/package.json'), JSON.stringify({ name: 'pnpm', version }));
 writeFileSync(join(runtime, 'pnpm/bin/pnpm.cjs'), 'fixture');
 return runtime;
}

test('update runtime checks the installed executables without switching package managers', t => {
 const runtime = fixture(t);
 const calls = [];
 assertUpdateRuntime(runtime, (executable, args, options) => {
  calls.push({ executable, args });
  assert.equal(options.cwd, runtime);
  assert.ok(options.timeout > 0 && options.timeout <= 10000);
  return { status: 0, stdout: args[0] === '--version' ? `v${NODE_VERSION}\n` : `${PNPM_VERSION}\n` };
 });
 assert.equal(calls.length, 2);
 assert.equal(calls[0].executable, join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node'));
 assert.equal(calls[1].args[0], join(runtime, 'pnpm/bin/pnpm.cjs'));
 assert.ok(calls[1].args.includes('--config.manage-package-manager-versions=false'));
});

for (const version of ['24.19.0', '24.22.0', '22.23.4', '25.0.0', '24.22.1-rc.1', 'garbage']) {
 test(`update rejects Node ${version} with a full-installer repair instruction`, t => {
  const runtime = fixture(t);
  assert.throws(() => assertUpdateRuntime(runtime, () => ({ status: 0, stdout: `v${version}` })), error => {
   assert.equal(error.code, RUNTIME_REPAIR_CODE);
   assert.match(error.message, /full Windows installer/);
   return true;
  });
 });
}

test('a later patch in the supported Node line remains usable', t => {
 const runtime = fixture(t);
 assertUpdateRuntime(runtime, (_executable, args) => ({ status: 0, stdout: args[0] === '--version' ? 'v24.22.2' : PNPM_VERSION }));
});

test('old pnpm metadata is rejected before any executable starts', t => {
 const runtime = fixture(t, '10.21.0');
 let invoked = false;
 assert.throws(() => assertUpdateRuntime(runtime, () => { invoked = true; return {status:0, stdout:PNPM_VERSION}; }), { code: RUNTIME_REPAIR_CODE });
 assert.equal(invoked, false);
});

for (const result of [{ status: 1, stdout: PNPM_VERSION }, { status: null, error: new Error('timeout') }, { status: 0, stdout: '10.21.0' }]) {
 test(`pnpm version probe refuses ${JSON.stringify(result)}`, t => {
  const runtime = fixture(t);
  assert.throws(() => assertUpdateRuntime(runtime, (_executable, args) => args[0] === '--version' ? { status: 0, stdout: `v${NODE_VERSION}` } : result), { code: RUNTIME_REPAIR_CODE });
 });
}

test('missing runtime metadata gives a repair instruction rather than a filesystem error', t => {
 const runtime = fixture(t);
 rmSync(join(runtime, 'pnpm/package.json'));
 assert.throws(() => assertUpdateRuntime(runtime), { code: RUNTIME_REPAIR_CODE });
});
