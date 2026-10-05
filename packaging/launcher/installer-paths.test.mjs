import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const template = readFileSync(new URL("./installer.nsi", import.meta.url), "utf8");
const messages = readFileSync(new URL("./installer-messages.nsh", import.meta.url), "utf8");
const hooks = readFileSync(new URL("./installer-hooks.nsh", import.meta.url), "utf8");
test("organization default is set only while install location is unset", () => {
  const initialization = template.slice(template.indexOf('Function .onInit'), template.indexOf('Function un.onInit'));
  const block = initialization.indexOf('${If} $INSTDIR == "${PLACEHOLDER_INSTALL_DIR}"');
  const organization = initialization.indexOf('StrCpy $INSTDIR "$LOCALAPPDATA\\Shisa.ai\\Jouzu"');
  assert.ok(block >= 0 && organization > block);
  assert.ok(initialization.indexOf('Call RestorePreviousInstallLocation', organization) > organization);
});
test("installation hooks never replace the selected destination", () => {
  assert.doesNotMatch(hooks, /StrCpy\s+\$INSTDIR/);
  assert.match(hooks, /-InstallRoot "\$INSTDIR"/);
});

test("uninstall removes installation metadata independently of user-data choice", () => {
  const block = template.slice(template.indexOf("; Installation metadata is not user data."), template.indexOf("!ifmacrodef NSIS_HOOK_POSTUNINSTALL"));
  assert.ok(block.indexOf('DeleteRegKey SHCTX "${MANUPRODUCTKEY}"') >= 0);
  assert.ok(block.indexOf('DeleteRegKey SHCTX "${MANUPRODUCTKEY}"') < block.indexOf('${If} $DeleteAppDataCheckboxState = 1'));
  assert.ok(block.indexOf('${If} $UpdateMode <> 1') < block.indexOf('DeleteRegKey SHCTX'));
});

test("destructive data removal requires explicit confirmation and reports leftovers", () => {
  const confirm = template.slice(template.indexOf('Function un.ConfirmLeave'), template.indexOf('!insertmacro MUI_UNPAGE_CONFIRM'));
  assert.match(confirm, /MB_YESNO\|MB_DEFBUTTON2/);
  assert.match(messages, /cannot be undone/);
  assert.match(messages, /custom JOUZU_HOME/);
  assert.match(messages, /Project files.*NOT deleted/);
  const removal = template.slice(template.indexOf('Section Uninstall'));
  assert.match(removal, /SetErrorLevel 1/);
  assert.match(removal, /jouzuDeleteFailed/);
});

test("data removal uses extended Windows paths for deep session trees", () => {
  const block = template.slice(template.indexOf('Section Uninstall'), template.indexOf('!ifmacrodef NSIS_HOOK_POSTUNINSTALL'));
  const removals = block.split('\n').filter(line => line.includes('RmDir /r'));
  assert.ok(removals.length > 0);
  for (const line of removals) assert.ok(line.includes(String.fromCharCode(34, 92, 92, 63, 92)), line);
});

test("data failure aborts before program and registration removal", () => {
  const section = template.slice(template.indexOf("Section Uninstall"));
  const cleanup = section.indexOf("$(jouzuDeleteFailed)");
  assert.ok(cleanup > 0);
  assert.ok(cleanup < section.indexOf('Delete "$INSTDIR'));
  assert.ok(cleanup < section.indexOf('DeleteRegKey'));
  assert.match(section.slice(0, section.indexOf('Delete "$INSTDIR')), /SetErrorLevel 1[\s\S]*Abort/);
});

test("all four installer locales contain the same custom message keys", () => {
  const languages = ["ENGLISH", "JAPANESE", "SIMPCHINESE", "TRADCHINESE"];
  const entries = [...messages.matchAll(/LangString (\w+) \$\{LANG_(\w+)\} "(.+)"/g)];
  const keys = ["jouzuCloseSessions", "jouzuCloseFailed", "jouzuDeleteData", "jouzuDeleteFailed", "jouzuRemoveFailed"].sort();
  for (const language of languages) {
    assert.deepEqual(entries.filter(entry => entry[2] === language).map(entry => entry[1]).sort(), keys);
  }
  const config = JSON.parse(readFileSync(new URL("../../apps/launcher/src-tauri/tauri.conf.json", import.meta.url)));
  assert.deepEqual(config.bundle.windows.nsis.languages, ["English", "Japanese", "SimpChinese", "TradChinese"]);
  assert.equal(config.bundle.windows.nsis.displayLanguageSelector, true);
});

test("language is remembered independently of installation location", () => {
  assert.doesNotMatch(template, /!define MUI_LANGDLL_ALWAYSSHOW/);
  assert.match(template, /!define MUI_LANGDLL_ALLLANGUAGES/);
  assert.ok(template.includes('!define MUI_LANGDLL_REGISTRY_KEY "${JOUZU_PREFERENCES_KEY}"'));
  const cleanup = template.slice(template.indexOf('; Installation metadata is not user data.'));
  const condition = cleanup.indexOf('${If} $DeleteAppDataCheckboxState = 1');
  const deletion = cleanup.indexOf('DeleteRegValue HKCU "${JOUZU_PREFERENCES_KEY}" "Installer Language"');
  assert.ok(condition >= 0 && deletion > condition);
  assert.ok(template.indexOf('$(jouzuDeleteFailed)') < template.indexOf('; Installation metadata is not user data.'));
});

test('updater uses quiet NSIS and skips language UI with remembered fallback', () => {
  const config = JSON.parse(readFileSync(new URL('../../apps/launcher/src-tauri/tauri.conf.json', import.meta.url)));
  assert.equal(config.plugins.updater.windows.installMode, 'quiet');
  const init = template.slice(template.indexOf('Function .onInit'), template.indexOf('!insertmacro SetContext', template.indexOf('Function .onInit')));
  assert.match(init, /CreateMutexW/);
  assert.match(init, /SetErrorLevel 1618/);
  assert.match(init, /\$UpdateMode = 1[\s\S]*StrCpy \$LANGUAGE 1033[\s\S]*ReadRegStr[\s\S]*\$\{Else\}[\s\S]*MUI_LANGDLL_DISPLAY/);
  assert.match(hooks, /\$UpdateMode = 1[\s\S]*-RefuseActiveSessions/);
});

test('ordinary uninstall removes managed program versions before user-data decision',()=>{
 const section=template.slice(template.indexOf('Section Uninstall'));
 const cleanup=section.indexOf('Jouzu'+String.fromCharCode(92)+'updates'+String.fromCharCode(34));
 assert.ok(cleanup>0);
 assert.ok(section.lastIndexOf('${If} $UpdateMode <> 1',cleanup)>=0);
 assert.ok(cleanup<section.indexOf('${If} $DeleteAppDataCheckboxState = 1'));
 assert.ok(cleanup<section.indexOf('Delete "$INSTDIR'));
});

test("component preparation belongs to the installer and never fails it", () => {
  const start = hooks.indexOf('!macro NSIS_HOOK_POSTINSTALL');
  const post = hooks.slice(start, hooks.indexOf('!macroend', start));
  // Components belong to the launcher: the installer prepares what the package carries and never
  // fails the installation for one, because the System section can install it afterwards.
  assert.match(post, /git-environment\.ps1.*-InstallRoot.*-Prepare/);
  assert.match(post, /terminal-environment\.ps1.*-InstallRoot.*-Prepare/);
  assert.ok(post.includes(String.raw`IfFileExists "$INSTDIR\runtime\git\PortableGit.exe" 0 `));
  assert.ok(post.includes(String.raw`IfFileExists "$INSTDIR\runtime\terminal\WindowsTerminal.zip" 0 `));
  assert.doesNotMatch(post, /Abort/, 'a component never fails the installation');
  const build = readFileSync(new URL('./prepare-windows-bundle.ps1', import.meta.url), 'utf8');
  assert.doesNotMatch(build, /Start-Process|signCommand/);
  assert.match(build, /runtime\/git\/PortableGit\.exe/);
});

test("installer commands preserve Windows path separators", () => {
  assert.ok(hooks.includes(String.raw`$INSTDIR\runtime\launcher-update\git-environment.ps1`));
  assert.ok(hooks.includes(String.raw`$SYSDIR\WindowsPowerShell\v1.0\powershell.exe`));
});

test("uninstaller signing failure aborts bundle generation", () => {
  const commands = template.split('\n').filter(line => line.trim().startsWith('!uninstfinalize'));
  assert.ok(commands.length > 0);
  assert.ok(commands.every(line => line.trim().endsWith('= 0')));
});

test("the Rust crate version matches the application version", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../apps/launcher/package.json", import.meta.url), "utf8"));
  const cargo = readFileSync(new URL("../../apps/launcher/src-tauri/Cargo.toml", import.meta.url), "utf8");
  const match = cargo.match(/^version = "([^"]+)"/m);
  assert.ok(match, "Cargo.toml must declare a version");
  assert.equal(match[1], pkg.version);
  // The lock pins the crate version too, and CI builds with --locked, so a version bump that
  // skips the lock would fail the release build instead of the release.
  const lock = readFileSync(new URL("../../apps/launcher/src-tauri/Cargo.lock", import.meta.url), "utf8");
  const entry = lock.match(new RegExp('name = "jouzu-launcher"' + '\n' + 'version = "([^"]+)"'));
  assert.ok(entry, "Cargo.lock must pin the launcher crate version");
  assert.equal(entry[1], pkg.version);
});

test("the launcher version has a single committed source", () => {
  const config = JSON.parse(readFileSync(new URL("../../apps/launcher/src-tauri/tauri.conf.json", import.meta.url), "utf8"));
  assert.equal(config.version, "../package.json");
  const pkg = JSON.parse(readFileSync(new URL("../../apps/launcher/package.json", import.meta.url), "utf8"));
  assert.match(pkg.version, /^\d+\.\d+\.\d+$/);
  const build = readFileSync(new URL("./prepare-windows-bundle.ps1", import.meta.url), "utf8");
  assert.doesNotMatch(build, /\$Version/);
  assert.doesNotMatch(build, /version = /);
});

test('uninstall closes the launcher and reports program-file failures honestly', () => {
 const hooks = readFileSync(new URL('./installer-hooks.nsh', import.meta.url), 'utf8');
 const installer = readFileSync(new URL('./installer.nsi', import.meta.url), 'utf8');
 const messages = readFileSync(new URL('./installer-messages.nsh', import.meta.url), 'utf8');
 // A launcher-only package keeps sessions open while replacing files, but an uninstall deletes
 // those files, so it must stop the launcher as well.
 const pre = hooks.slice(hooks.indexOf('!macro NSIS_HOOK_PREUNINSTALL'), hooks.indexOf('!macro NSIS_HOOK_POSTINSTALL'));
 assert.ok(pre.includes('JOUZU_STOP_ALL'), 'uninstall must stop the launcher too');
 // Payload removal belongs to an uninstall, never to an update.
 const post = hooks.slice(hooks.indexOf('!macro NSIS_HOOK_POSTUNINSTALL'));
 assert.ok(post.includes('$UpdateMode <> 1'), 'payload removal is uninstall-only');
 assert.ok(post.includes('jouzuRemoveFailed'), 'leftovers are reported');
 // Program files and user data fail for different reasons, so only the branch that deletes user
 // data may use the user-data message.
 assert.equal(installer.split('$(jouzuDeleteFailed)').length - 1, 1);
 assert.equal(installer.split('$(jouzuRemoveFailed)').length - 1, 2);
 for (const language of ['LANG_ENGLISH', 'LANG_JAPANESE', 'LANG_SIMPCHINESE', 'LANG_TRADCHINESE']) {
  assert.ok(messages.includes('LangString jouzuRemoveFailed ' + '${' + language + '}'), language);
 }
});
