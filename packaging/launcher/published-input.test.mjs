import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { verifyPublishedTarball } from './published-input.mjs';
const bytes=Buffer.from('tarball fixture');
const metadata={name:'jouzu',version:'0.1.18',dist:{tarball:'https://registry.npmjs.org/jouzu/-/jouzu-0.1.18.tgz',integrity:'sha512-'+createHash('sha512').update(bytes).digest('base64')}};
test('records the official npm input without a launcher-specific version',()=>{
 const receipt=verifyPublishedTarball(bytes,metadata,'0.1.18');
 assert.equal(receipt.name,'jouzu');assert.equal(receipt.version,'0.1.18');assert.equal(receipt.integrity,metadata.dist.integrity);
});
test('rejects changed bytes and wrong versions',()=>{
 assert.throws(()=>verifyPublishedTarball(Buffer.from('changed'),metadata,'0.1.18'),/integrity mismatch/);
 assert.throws(()=>verifyPublishedTarball(bytes,metadata,'0.1.17'),/identity mismatch/);
});
test('rejects alternative package identities and download sources',()=>{
 assert.throws(()=>verifyPublishedTarball(bytes,{...metadata,name:'jouzu-launcher'},'0.1.18'),/identity mismatch/);
 for(const tarball of ['http://registry.npmjs.org/jouzu/-/jouzu-0.1.18.tgz','https://example.com/jouzu.tgz','https://registry.npmjs.org/other/-/other-0.1.18.tgz','https://user:password@registry.npmjs.org/jouzu/-/jouzu-0.1.18.tgz']){
  assert.throws(()=>verifyPublishedTarball(bytes,{...metadata,dist:{...metadata.dist,tarball}},'0.1.18'),/official/);
 }
});
test('requires a complete SHA512 integrity value',()=>{
 for(const integrity of ['', 'sha1-abc', 'sha512-abc'])assert.throws(()=>verifyPublishedTarball(bytes,{...metadata,dist:{...metadata.dist,integrity}},'0.1.18'),/integrity/);
});
