import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { parseJouzuArgs } from "../dist/args.js";
import { applyProfile } from "../dist/profile-manager.js";
import { loadBundledProfile } from "../dist/profiles.js";
import { fitTerminalText, padTerminalText, terminalTextWidth } from "../dist/terminal-layout.js";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const cli = join(packageRoot, "dist", "cli.js");
const fixture = fileURLToPath(new URL("./fixtures/cjk/要件　仕様.md", import.meta.url));

function hash(bytes) {
	return createHash("sha256").update(bytes).digest("hex");
}

function paths(root) {
	return {
		agentDir: join(root, "agent"),
		stateDir: join(root, "state"),
		cacheDir: join(root, "cache"),
		sessionDir: join(root, "state", "sessions"),
		profileStatePath: join(root, "state", "profile-state.json"),
		backupDir: join(root, "state", "backups"),
	};
}

test("the reviewed mixed-width Japanese fixture remains byte-stable", () => {
	const bytes = readFileSync(fixture);
	assert.equal(hash(bytes), "7467a20c9adb7210bbfeb989d5500731e9f33d29e67485545175062be63acb6b");
	const text = bytes.toString("utf8");
	for (const expected of ["こんにちは", "ジョウズ", "ｼﾞｮｳｽﾞ", "上手", "ば", "ば", "🦁", "左　右"]) {
		assert.ok(text.includes(expected), expected);
	}
});

test("combining marks, full-width spaces, emoji, and variation selectors measure by display width", () => {
	// The product width helper delegates to Pi TUI's terminal-width
	// implementation: zero-width marks add nothing and wide glyphs count as two.
	assert.equal(terminalTextWidth("か\u3099"), 2);
	assert.equal(terminalTextWidth("\u3000"), 2);
	assert.equal(terminalTextWidth("🦁"), 2);
	assert.equal(terminalTextWidth("❤\ufe0f"), 2);
	assert.equal(terminalTextWidth("👨‍👩‍👧"), 2);
	assert.equal(terminalTextWidth("か\u3099\u3000🦁\ufe0f❤\ufe0f"), 8);
});

test("combining characters, full-width spaces, variant characters, and emoji keep a correct width", () => {
	// A combining mark adds no column to the character it modifies, whether the
	// base is a kana, a CJK ideograph, or a Latin letter.
	assert.equal(terminalTextWidth("か\u3099"), terminalTextWidth("か"));
	assert.equal(terminalTextWidth("は\u3099"), terminalTextWidth("は"));
	assert.equal(terminalTextWidth("e\u0301"), terminalTextWidth("e"));

	// A full-width space and a full-width letter are each two columns.
	assert.equal(terminalTextWidth("\u3000"), 2);
	assert.equal(terminalTextWidth("Ａ"), 2);

	// Variant characters: the CJK Compatibility Ideographs and the common
	// variant forms of a character are all wide, so replacing a character with
	// its variant never changes the column count.
	for (const variant of ["邊", "邉", "國", "国", "高", "髙", "斎", "齋", "\uF900", "\uFA0C"]) {
		assert.equal(terminalTextWidth(variant), 2, `variant ${JSON.stringify(variant)} is not two columns`);
	}

	// Emoji: a ZWJ sequence, a skin-tone modifier, a regional-indicator flag, a
	// keycap, and an emoji-presentation selector each stay one wide glyph, while
	// a text-presentation selector keeps the narrow base width.
	assert.equal(terminalTextWidth("👨‍👩‍👧"), 2, "a ZWJ sequence is one wide glyph");
	assert.equal(terminalTextWidth("👍🏽"), 2, "a skin-tone modifier adds no column");
	assert.equal(terminalTextWidth("🇯🇵"), 2, "a regional-indicator flag is one wide glyph");
	assert.equal(terminalTextWidth("1️⃣"), 2, "a keycap is one wide glyph");
	assert.equal(terminalTextWidth("❤\ufe0f"), 2, "an emoji-presentation selector is zero width");
	assert.equal(terminalTextWidth("❤\ufe0e"), 1, "a text-presentation selector keeps the narrow base");
});

test("fitting and padding keep every combining, full-width, variant, and emoji case inside its column", () => {
	// A wrong width shows up as a line that is short or over its column, so each
	// case is fitted and padded to every column from zero and the result must
	// land exactly on the column.
	const cases = [
		["combining mark", "か\u3099"],
		["full-width space", "\u3000"],
		["full-width letter", "Ａ"],
		["variant character", "邊"],
		["compatibility ideograph", "\uF900"],
		["emoji ZWJ sequence", "👨‍👩‍👧"],
		["emoji skin tone", "👍🏽"],
		["emoji flag", "🇯🇵"],
		["emoji keycap", "1️⃣"],
		["emoji variation selector", "❤\ufe0f"],
	];
	for (const [name, value] of cases) {
		for (let columns = 0; columns <= 12; columns += 1) {
			assert.ok(terminalTextWidth(fitTerminalText(value, columns)) <= columns, `${name} fit at ${columns}`);
			assert.equal(terminalTextWidth(padTerminalText(value, columns)), columns, `${name} pad at ${columns}`);
		}
	}
});

test("profile operations preserve CJK paths, normalization, BOM, CRLF, and user bytes", () => {
	const root = mkdtempSync(join(tmpdir(), "jouzu-cjk-"));
	try {
		const jouzuHome = join(root, "上手　home");
		const project = join(root, "日本語 project");
		const decomposedName = `は\u3099-${"仕様"}.txt`;
		mkdirSync(project, { recursive: true });
		writeFileSync(join(project, "要件　仕様.md"), readFileSync(fixture));
		writeFileSync(join(project, decomposedName), "結合文字を保持\n");
		writeFileSync(join(project, "BOM.txt"), Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from("日本語\n")]));
		writeFileSync(join(project, "CRLF.txt"), Buffer.from("一行目\r\n二行目\r\n"));
		mkdirSync(join(jouzuHome, "agent"), { recursive: true });
		writeFileSync(join(jouzuHome, "agent", "AGENTS.md"), "利用者所有の指示　🦁\r\n");

		const tracked = [
			join(project, "要件　仕様.md"),
			join(project, decomposedName),
			join(project, "BOM.txt"),
			join(project, "CRLF.txt"),
			join(jouzuHome, "agent", "AGENTS.md"),
		];
		const before = new Map(tracked.map((path) => [path, hash(readFileSync(path))]));
		applyProfile(loadBundledProfile("ja"), paths(jouzuHome), "0.1.0");
		const after = new Map(tracked.map((path) => [path, hash(readFileSync(path))]));
		assert.deepEqual(after, before);
		assert.ok(readdirSync(project).includes(decomposedName));
		assert.equal(readFileSync(join(project, "BOM.txt")).subarray(0, 3).toString("hex"), "efbbbf");
		assert.match(readFileSync(join(project, "CRLF.txt"), "utf8"), /一行目\r\n二行目\r\n/);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});

test("Unicode arguments and no-color diagnostics preserve exact text", () => {
	const args = ["--jouzu-home", "./上手　home", "pi", "@要件　仕様.md", "日本語で確認 🦁"];
	assert.deepEqual(parseJouzuArgs(args).args, ["@要件　仕様.md", "日本語で確認 🦁"]);

	const root = mkdtempSync(join(tmpdir(), "jouzu-cjk-terminal-"));
	try {
		const home = join(root, "端末　上手");
		const result = spawnSync(process.execPath, [cli, "--jouzu-home", home, "profile", "plan"], {
			encoding: "utf8",
			env: { ...process.env, NO_COLOR: "1", TERM: "dumb", PI_OFFLINE: "1" },
		});
		assert.equal(result.status, 0, result.stderr);
		assert.match(result.stdout, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
		assert.equal(result.stdout.includes("\u001b["), false);
		assert.equal(result.stdout.normalize("NFC").includes(home.normalize("NFC")), true);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
});
