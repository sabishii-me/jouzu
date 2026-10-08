import assert from "node:assert/strict";
import test from "node:test";
import { assertDefaultInstallation } from "./check-default-installation.mjs";

const report = (issues = []) => ({
	fields: [{ id: "camoufox.runtime", value: "not installed; installs on first browser tool use" }],
	issues,
});
const pending = { compatibilityStatus: "pending-qualification" };
const problem = (id) => ({ id, severity: "problem" });
test("pending candidates permit only the explicit qualification diagnostic", () => {
	assert.doesNotThrow(() => assertDefaultInstallation(report([problem("pi.lockUnqualified")]), 1, pending));
	assert.throws(() =>
		assertDefaultInstallation(report([problem("pi.lockUnqualified"), problem("extensions.unavailable")]), 1, pending),
	);
	assert.throws(() => assertDefaultInstallation(report([problem("pi.lockUnqualified")]), 0, pending));
	assert.throws(() => assertDefaultInstallation(report(), 0, pending));
});
test("qualified candidates require a clean doctor and absent Camoufox", () => {
	assert.doesNotThrow(() => assertDefaultInstallation(report(), 0, { compatibilityStatus: "qualified" }));
	assert.throws(() =>
		assertDefaultInstallation(report([problem("pi.lockUnqualified")]), 1, { compatibilityStatus: "qualified" }),
	);
	assert.throws(() => assertDefaultInstallation({ ...report(), fields: [] }, 0, { compatibilityStatus: "qualified" }));
});
