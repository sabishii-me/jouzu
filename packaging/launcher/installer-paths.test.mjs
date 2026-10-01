import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const template = readFileSync(new URL("./installer.nsi", import.meta.url), "utf8");
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
  assert.match(confirm, /cannot be undone/);
  assert.match(confirm, /custom JOUZU_HOME/);
  assert.match(confirm, /Project files.*NOT deleted/);
  const removal = template.slice(template.indexOf('; Installation metadata is not user data.'));
  assert.match(removal, /SetErrorLevel 1/);
  assert.match(removal, /User-data deletion is NOT complete/);
});
