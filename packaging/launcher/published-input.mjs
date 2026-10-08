import { createHash, timingSafeEqual } from 'node:crypto';

/** Authenticate the official npm tarball before any extraction or package execution. */
export function verifyPublishedTarball(bytes, metadata, version) {
 if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new Error('Invalid Jouzu version');
 if (metadata?.name !== 'jouzu' || metadata.version !== version) throw new Error('Published package identity mismatch');
 const url = new URL(metadata.dist?.tarball);
 if (url.protocol !== 'https:' || url.hostname !== 'registry.npmjs.org' || url.port || url.username || url.password || url.search || url.hash || url.pathname !== `/jouzu/-/jouzu-${version}.tgz`) {
  throw new Error('Expected the official Jouzu npm tarball');
 }
 const integrity = metadata.dist?.integrity;
 if (typeof integrity !== 'string' || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(integrity)) throw new Error('Missing SHA512 npm integrity');
 const expected = Buffer.from(integrity.slice(7), 'base64');
 const actual = createHash('sha512').update(bytes).digest();
 if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) throw new Error('Published tarball integrity mismatch');
 return {name:'jouzu', version, url:url.href, integrity, sha256:createHash('sha256').update(bytes).digest('hex')};
}
