import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, sign } from 'node:crypto';
import { checkUpdateFeed } from './check-update-feed.mjs';

const { publicKey, privateKey } = generateKeyPairSync('ed25519');
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });

function manifest(version) {
 return Buffer.from(JSON.stringify({
  schemaVersion: 1, version, platform: 'win32', arch: 'x64',
  files: [
   { path: 'package.json', size: 10, sha256: 'a'.repeat(64) },
   { path: 'pnpm-lock.yaml', size: 10, sha256: 'b'.repeat(64) },
  ],
 }));
}

function fetchFor({ npmVersion, feedVersion = npmVersion, withSignature = true }) {
 const bytes = manifest(feedVersion);
 return async (url) => {
  if (url.endsWith('/jouzu/latest')) return { ok: true, json: async () => ({ version: npmVersion }) };
  if (url.endsWith('manifest.json')) return { ok: true, arrayBuffer: async () => bytes };
  if (url.endsWith('manifest.sig')) {
   if (!withSignature) return { ok: false, status: 404 };
   return { ok: true, arrayBuffer: async () => sign(null, bytes, privateKey) };
  }
  throw new Error(`unexpected ${url}`);
 };
}

const open = { recipeBaseUrl: 'https://example.test/feed/', publicKey: publicPem };

test('accepts a signed feed that matches the published npm version', async () => {
 const result = await checkUpdateFeed({ ...open, fetchImpl: fetchFor({ npmVersion: '0.1.18' }) });
 assert.deepEqual(result, { version: '0.1.18', files: 2 });
});

test('rejects a feed for a different version than the published one', async () => {
 await assert.rejects(
  checkUpdateFeed({ ...open, fetchImpl: fetchFor({ npmVersion: '0.1.18', feedVersion: '0.1.17' }) }),
  /target mismatch|does not match/);
});

test('rejects a missing or unsecured feed', async () => {
 await assert.rejects(checkUpdateFeed({ ...open, fetchImpl: fetchFor({ npmVersion: '0.1.18', withSignature: false }) }), /signature/);
 await assert.rejects(checkUpdateFeed({ recipeBaseUrl: 'http://example.test/feed/', publicKey: publicPem, fetchImpl: fetchFor({ npmVersion: '0.1.18' }) }), /HTTPS/);
});
