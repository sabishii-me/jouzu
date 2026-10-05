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
 // The callback must not depend on certificate cmdlets: the bundler spawns Windows PowerShell
 // where they are not guaranteed to load, so identity is asserted by the release script.
 assert.doesNotMatch(script, /Get-AuthenticodeSignature/);
 const finalize = read('finalize-windows-bundle.ps1');
 assert.match(finalize, /SignerCertificate\.Subject -ne \$env:EXPECTED_SIGNER/);
 assert.match(finalize, /TimeStamperCertificate/);
});

test('release feed follows immutable asset upload and download integrity check', () => {
 const script = read('publish-launcher.ps1');
 const create = script.indexOf('gh release create $tag');
 const verify = script.indexOf('Published update integrity mismatch');
 const feed = script.indexOf('gh release upload launcher-update');
 assert.ok(create >= 0 && verify > create && feed > verify);
 assert.doesNotMatch(script.slice(create, verify), /--clobber/);
 // The launcher-only artifact is addressed by the name the release stored: GitHub rewrites
 // spaces in asset names, so the local file name would build a URL that does not exist.
 assert.match(script.slice(create, verify), /--json assets/);
 // `gh --jq` rejects single-quoted string literals in the expression, and a botched edit can
 // still parse while producing an unusable expression, so the shape is asserted directly.
 assert.match(script.slice(create, verify), /--jq '\.assets\[\]\.name'/);
 assert.doesNotMatch(script, /endswith\('/);
 assert.doesNotMatch(script, /\+\s*BS\s*\+/);
 // The feed's notes field is a string in both documented update formats; a command's output is
 // a list of lines in PowerShell, which would ship an array the client cannot parse.
 assert.match(script, /-join "`n"/);
 assert.match(script.slice(create, verify), /-update\.exe/);
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
 // signed payload binary would break the feature and carry the Jouzu publisher identity.
 assert.match(signer, /SkipRoots/);
 assert.match(signer, /StartsWith\(\$skip, \[StringComparison\]::OrdinalIgnoreCase\)\) \{/);
 // A failing signature must reach the log the release prints.
 assert.match(signer, /FAILED: /);
 const finalize = read('finalize-windows-bundle.ps1');
 assert.match(finalize, /\$skipRoots = @\("\$inputRoot\/app","\$inputRoot\/runtime"/);
 // Configuration reaches the signer through the environment, so the bundler only substitutes one argument.
 assert.match(finalize, /\$env:JOUZU_SIGN_SKIP_ROOTS = \(\$skipRoots -join ';'\)/);
 assert.match(finalize, /sign-windows\.ps1",'%1'/);
});

test('the bundler refuses a launcher that would load a development server', () => {
 const finalize = read('finalize-windows-bundle.ps1');
 // The check is compiled into the launcher and answers through its exit code.
 assert.match(finalize, /launcher\.exe'\) -ArgumentList '--production-build-check'/);
 assert.match(finalize, /\$check\.ExitCode -ne 0\) \{ throw /);
 const main = readFileSync(
  new URL('../../apps/launcher/src-tauri/src/main.rs', import.meta.url),
  'utf8',
 );
 assert.match(main, /--production-build-check/);
 assert.match(main, /tauri::is_dev\(\)/);
});
