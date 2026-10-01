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
  assert.ok(!block.includes('$DeleteAppDataCheckboxState'));
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
  const keys = ["jouzuCloseSessions", "jouzuCloseFailed", "jouzuDeleteData", "jouzuDeleteFailed"].sort();
  for (const language of languages) {
    assert.deepEqual(entries.filter(entry => entry[2] === language).map(entry => entry[1]).sort(), keys);
  }
  const config = JSON.parse(readFileSync(new URL("../../apps/launcher/src-tauri/tauri.conf.json", import.meta.url)));
  assert.deepEqual(config.bundle.windows.nsis.languages, ["English", "Japanese", "SimpChinese", "TradChinese"]);
  assert.equal(config.bundle.windows.nsis.displayLanguageSelector, true);
});
