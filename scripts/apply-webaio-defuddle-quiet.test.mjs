import assert from "node:assert/strict";
import { test } from "node:test";
import { transformDefuddleDiagnostics } from "./apply-webaio-defuddle-quiet.mjs";

test("Defuddle diagnostic guard silences only its console errors", () => {
	const source = `console.error("first");\nconsole.error("second");`;
	const transformed = transformDefuddleDiagnostics(source);
	assert.equal(transformed, `if (false) console.error("first");\nif (false) console.error("second");`);
});

test("Defuddle diagnostic guard rejects a changed dependency", () => {
	assert.throws(() => transformDefuddleDiagnostics("export const okay = true;"), /diagnostic anchors are missing/);
});
