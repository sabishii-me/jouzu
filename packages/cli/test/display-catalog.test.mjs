import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createDisplayCatalog } from "../dist/display-catalog.js";
import { loadCatalog } from "../dist/locale-catalog.js";

const localesRoot = fileURLToPath(new URL("../locales/", import.meta.url));

test("existing display catalog references follow confirmed language updates", () => {
	const ja = loadCatalog("ja", { localesRoot });
	const en = loadCatalog("en", { localesRoot });
	const controller = createDisplayCatalog(ja);
	const captured = controller.bundle;
	const id = "jouzu.cli.palette.tab.settings";
	assert.notEqual(ja.format(id), en.format(id));
	assert.equal(captured.locale, "ja");
	assert.equal(captured.format(id), ja.format(id));
	controller.update(en);
	assert.equal(controller.bundle, captured);
	assert.equal(captured.locale, "en");
	assert.equal(captured.version, en.version);
	assert.equal(captured.digest, en.digest);
	assert.equal(captured.messages, en.messages);
	assert.equal(captured.format(id), en.format(id));
	assert.deepEqual(captured.render(id, undefined, { columns: 48 }), en.render(id, undefined, { columns: 48 }));
	assert.equal(ja.locale, "ja");
	controller.update(ja);
	assert.equal(captured.locale, "ja");
	assert.equal(captured.format(id), ja.format(id));
});
