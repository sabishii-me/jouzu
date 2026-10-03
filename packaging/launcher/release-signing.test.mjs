import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const read = name => readFileSync(new URL(name, import.meta.url), 'utf8');

test('release signing scripts parse without invoking signing services', {skip: process.platform !== 'win32'}, () => {
 const files = ['sign-windows.ps1','finalize-windows-bundle.ps1','publish-launcher.ps1'];
 const paths = files.map(name => "'" + fileURLToPath(new URL(name, import.meta.url)).replaceAll("'", "''") + "'").join(',');
 const script = `foreach($file in @(${paths})){$errors=$null;[void][Management.Automation.Language.Parser]::ParseFile($file,[ref]$null,[ref]$errors);if($errors.Count){$errors;exit 1}}`;
 const result = spawnSync('powershell.exe', ['-NoProfile','-NonInteractive','-Command',script], {encoding:'utf8',timeout:10000,windowsHide:true});
 assert.equal(result.status, 0, result.stderr + result.stdout);
});

test('the bundler signing callback runs the documented signtool command', () => {
 const script = read('sign-windows.ps1');
 // The Artifact Signing SignTool integration: digest, RFC3161 timestamp, dlib and metadata.
 assert.match(script, /\/fd SHA256/);
 assert.match(script, /\/tr http:\/\/timestamp\.acs\.microsoft\.com/);
 assert.match(script, /\/dlib \$Dlib \/dmdf \$Metadata/);
 // A signature that is not the expected signer, or is untimestamped, must stop the release.
 assert.match(script, /SignerCertificate\.Subject -ne \$ExpectedSubject/);
 assert.match(script, /TimeStamperCertificate/);
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
 // The CLI reads the updater key from the environment; this script never writes it out.
 assert.doesNotMatch(script, /WriteAllText\([^)]*TAURI_SIGNING_PRIVATE_KEY/);
 assert.match(script, /signer sign --app-version/);
 // The updater key is never materialised on disk by this script.
});

test('the payload is excluded from signing so vendor bytes stay pinned', () => {
 const signer = read('sign-windows.ps1');
 // textguard-native.js rejects a binary whose size or SHA256 differs from its manifest, so a
 // signed payload binary would break the feature and carry our publisher identity.
 assert.match(signer, /SkipRoots/);
 assert.match(signer, /StartsWith\(\$skip, \[StringComparison\]::OrdinalIgnoreCase\)\) \{ exit 0 \}/);
 const finalize = read('finalize-windows-bundle.ps1');
 assert.match(finalize, /\$skipRoots = @\("\$inputRoot\/app","\$inputRoot\/runtime"/);
 assert.match(finalize, /'-SkipRoots',\(\$skipRoots -join ';'\)/);
});
