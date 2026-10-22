import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { PNPM_VERSION } from './prepare-starter.mjs';
import { RUNTIME_REPAIR_MESSAGE } from './runtime-requirements.mjs';

for (const tamper of [false, true]) {
 test(`update service ${tamper ? 'rejects a tampered recipe before runtime checks' : 'directs existing installs to the full installer without activating'}`, async t => {
  const root = mkdtempSync(join(tmpdir(), 'jouzu-service-runtime-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const install = join(root, 'install'); mkdirSync(install);
  const managed = join(root, 'managed'); mkdirSync(join(managed, 'updates'), { recursive: true });
  const active = JSON.stringify({ schemaVersion: 1, version: '0.1.18', slot: 'bundled' });
  writeFileSync(join(managed, 'updates/active.json'), active);
  const files = {
   'package.json': Buffer.from(JSON.stringify({packageManager:`pnpm@${PNPM_VERSION}`, dependencies:{jouzu:'file:artifacts/jouzu.tgz'}})),
   'pnpm-lock.yaml': Buffer.from('fixture'),
  };
  const keys = generateKeyPairSync('ed25519');
  const manifest = Buffer.from(JSON.stringify({schemaVersion:1, version:'0.1.19', platform:process.platform, arch:process.arch, files:Object.entries(files).map(([path, body])=>({path, size:body.length, sha256:createHash('sha256').update(body).digest('hex')}))}));
  const signature = sign(null, manifest, keys.privateKey);
  const server = createServer((request, response) => {
   if (request.url === '/manifest.json') return response.end(manifest);
   if (request.url === '/manifest.sig') return response.end(signature);
   const body = files[request.url.slice(1)];
   if (!body) return response.writeHead(404).end();
   response.end(tamper ? Buffer.alloc(body.length) : body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  writeFileSync(join(install, 'jouzu-update.json'), JSON.stringify({url:`http://127.0.0.1:${server.address().port}/`, publicKey:keys.publicKey.export({type:'spki', format:'pem'}), allowLoopbackHttp:true}));
  const result = await new Promise((resolve, reject) => {
   const child = spawn(process.execPath, [fileURLToPath(new URL('./update-service.mjs', import.meta.url)), install, managed, 'install'], {windowsHide:true, timeout:20000});
   let stdout = '', stderr = '';
   child.stdout.on('data', chunk => { stdout += chunk; });
   child.stderr.on('data', chunk => { stderr += chunk; });
   child.on('error', reject);
   child.on('close', (code, signal) => resolve({code, signal, stdout, stderr}));
   child.stdin.end(JSON.stringify({version:'0.1.19'}));
  });
  assert.equal(result.code, 1, result.stderr);
  assert.equal(result.signal, null);
  const error = JSON.parse(result.stdout).error;
  if (tamper) {
   assert.notEqual(error, RUNTIME_REPAIR_MESSAGE);
   assert.match(error, /Jouzu update failed/);
  } else assert.equal(error, RUNTIME_REPAIR_MESSAGE);
  assert.equal(readFileSync(join(managed, 'updates/active.json'), 'utf8'), active);
  assert.equal(readdirSync(join(managed, 'updates')).some(name=>name.startsWith('recipe-') || name === 'operation.lock'), false);
  assert.deepEqual(readdirSync(join(managed, 'updates/versions')), []);
 });
}
