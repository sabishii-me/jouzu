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
