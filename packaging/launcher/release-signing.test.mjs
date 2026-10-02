import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');

test('release signing scripts parse without invoking signing services', {skip: process.platform !== 'win32'}, () => {
 const files = ['azure-oidc-login.ps1','sign-bundle-file.ps1','sign-uninstaller.ps1','finalize-windows-bundle.ps1','publish-launcher.ps1'];
 const paths = files.map(name => "'" + fileURLToPath(new URL(name, import.meta.url)).replaceAll("'", "''") + "'").join(',');
 const script = `foreach($file in @(${paths})){$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$errors);if($errors.Count){$errors;exit 1}}`;
 const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], {encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('vendor resource callback cannot invoke the signing service', () => {
 const script = read('sign-bundle-file.ps1');
 const vendor = script.slice(script.indexOf('foreach ($root in $resources)'));
 assert.doesNotMatch(vendor, /sign-windows|signtool|az login/);
 assert.match(vendor, /throw/);
});

test('release feed follows immutable asset upload and download integrity check', () => {
 const script = read('publish-launcher.ps1');
 const create = script.indexOf('gh release create $tag');
 const verify = script.indexOf('Published update integrity mismatch');
 const feed = script.indexOf('gh release upload launcher-update');
 assert.ok(create >= 0 && verify > create && feed > verify);
 assert.doesNotMatch(script.slice(create, verify), /--clobber/);
 // The feed must serve the launcher-only artifact, not the full package.
 assert.match(script.slice(verify, feed), /\$updateSetup/);
});

test('finalization signs updater only after final Authenticode verification', () => {
 const script = read('finalize-windows-bundle.ps1');
 assert.ok(script.indexOf('Invalid final signature') < script.indexOf('signer sign'));
 assert.match(script, /Vendor resource modified/);
 assert.match(script, /Remove-Item -LiteralPath \$keyFile/);
});
