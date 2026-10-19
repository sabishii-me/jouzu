import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
	applyDefuddleDiagnosticGuard,
	resolveDefuddleSource,
	transformDefuddleDiagnostics,
} from "./apply-webaio-defuddle-quiet.mjs";

test("Defuddle diagnostic guard silences only its console errors", () => {
	const source = `console.error("first");\nconsole.error("second");`;
	const transformed = transformDefuddleDiagnostics(source);
	assert.equal(transformed, `if (false) console.error("first");\nif (false) console.error("second");`);
});

for (const layout of ["nested", "hoisted", "junction"]) {
	test(`Defuddle guard resolves and patches the ${layout} dependency`, (t) => {
		const root = mkdtempSync(join(tmpdir(), "jouzu-defuddle-"));
		t.after(() => rmSync(root, { recursive: true, force: true }));
		const webaio = join(root, "node_modules", "pi-webaio");
		const dependency = join(layout === "nested" ? webaio : root, "node_modules", "defuddle");
		mkdirSync(webaio, { recursive: true });
		mkdirSync(join(dependency, "dist"), { recursive: true });
		writeFileSync(join(webaio, "package.json"), JSON.stringify({ name: "pi-webaio" }));
		writeFileSync(
			join(dependency, "package.json"),
			JSON.stringify({
				name: "defuddle",
				exports: { ".": "./dist/index.js" },
			}),
		);
		writeFileSync(join(dependency, "dist", "index.js"), "");
		const source = join(dependency, "dist", "defuddle.js");
		writeFileSync(source, 'console.error("parse failure");');
		let anchor = webaio;
		if (layout === "junction") {
			anchor = join(root, "packages", "cli", "node_modules", "pi-webaio");
			mkdirSync(join(anchor, ".."), { recursive: true });
			symlinkSync(webaio, anchor, "junction");
		}
		const resolved = resolveDefuddleSource(anchor);
		assert.equal(resolved, realpathSync(source));
		assert.equal(
			applyDefuddleDiagnosticGuard(resolved, (path) => readFileSync(path, "utf8"), writeFileSync),
			true,
		);
		assert.equal(readFileSync(source, "utf8"), 'if (false) console.error("parse failure");');
	});
}

test("Defuddle diagnostic guard rejects a changed dependency", () => {
	assert.throws(() => transformDefuddleDiagnostics("export const okay = true;"), /diagnostic anchors are missing/);
});
