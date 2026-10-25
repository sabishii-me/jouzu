import assert from "node:assert/strict";
import { test } from "node:test";
import { wrapProseText } from "../dist/prose-wrap.js";
import {
	getOsc8LinkAtColumn,
	stripTerminalSequences,
	visibleWidth,
	wrapTextWithAnsi,
} from "../node_modules/@earendil-works/pi-tui/dist/index.js";

const RED = "\u001b[31m";
const RESET = "\u001b[0m";
const UNDERLINE = "\u001b[4m";
const UNDERLINE_OFF = "\u001b[24m";
const BACKGROUND = "\u001b[48;5;236m";
const BACKGROUND_OFF = "\u001b[49m";
const OSC8_OPEN = "\u001b]8;;https://example.com/日本語\u001b\\";
const OSC8_CLOSE = "\u001b]8;;\u001b\\";

function plain(lines) {
	return lines.map((line) => stripTerminalSequences(line));
}

test("Japanese prose breaks before closing punctuation instead of leaving it alone", () => {
	assert.deepEqual(wrapProseText("これは日本語です。", 8), ["これは日", "本語で", "す。"]);
	assert.deepEqual(wrapProseText("「これは日本語です」", 8), ["「これは", "日本語で", "す」"]);
	assert.deepEqual(wrapProseText("（これは日本語です）", 8), ["（これは", "日本語で", "す）"]);
	assert.deepEqual(wrapProseText("これは「日本語」です", 8), ["これは", "「日本", "語」です"]);
	assert.deepEqual(wrapProseText("これは（日本語）です", 8), ["これは", "（日本", "語）です"]);
});

test("small kana, iteration marks, and punctuation runs stay off the line start", () => {
	assert.deepEqual(wrapProseText("これはきょうです", 8), ["これは", "きょうで", "す"]);
	assert.deepEqual(wrapProseText("これは、日本語です。", 8), ["これは、", "日本語で", "す。"]);
	// Every boundary in the prohibited run is illegal, so width wins for the
	// final isolated mark; the earlier line still keeps the run together.
	assert.deepEqual(wrapProseText("これは日本語です。。。。", 8), ["これは日", "本語で", "す。。。", "。"]);
});

test("English words keep ordinary space breaks", () => {
	assert.deepEqual(wrapProseText("hello world again", 8), ["hello", "world", "again"]);
	assert.deepEqual(wrapProseText("a long English sentence", 10), ["a long", "English", "sentence"]);
	assert.deepEqual(wrapProseText("abcdefghij", 4), ["abcd", "efgh", "ij"]);
	assert.deepEqual(wrapProseText("これはhello worldです", 10), ["これは", "hello", "worldです"]);
});

test("non-Japanese prose uses Pi's baseline wrapper", () => {
	const cases = [
		["abcdefg.", 7],
		["hello   ", 8],
		["hello   world", 8],
		["a `b c`", 4],
		["see https://a.co now", 14],
		["e\u0301e\u0301e\u0301", 2],
		["👩‍💻👩‍💻", 2],
	];
	for (const [text, width] of cases) {
		assert.deepEqual(wrapProseText(text, width), wrapTextWithAnsi(text, width), `${JSON.stringify(text)} at ${width}`);
	}
	assert.deepEqual(
		wrapProseText("see https://a.co now", 14, [{ start: 4, end: 16 }]),
		wrapTextWithAnsi("see https://a.co now", 14),
	);
	assert.deepEqual(wrapProseText("a `b c` d", 4, [{ start: 2, end: 7 }]), wrapTextWithAnsi("a `b c` d", 4));
});

test("mixed prose delegates each non-CJK newline segment to baseline", () => {
	const english = "abcdefg.";
	const baseline = wrapTextWithAnsi(english, 7);
	assert.deepEqual(wrapProseText(`あ\n${english}`, 7), ["あ", ...baseline]);
	assert.deepEqual(wrapProseText("あ\nhello   ", 8), ["あ", ...wrapTextWithAnsi("hello   ", 8)]);

	const inherited = wrapProseText(`${RED}あ\n${english}${RESET}`, 7);
	assert.deepEqual(plain(inherited), ["あ", ...baseline.map((line) => stripTerminalSequences(line))]);
	assert.ok(inherited[1]?.startsWith(RED));
	assert.ok(inherited[2]?.startsWith(RED));

	const intoJapanese = wrapProseText(`${RED}${english}\nあ${RESET}`, 7);
	assert.deepEqual(plain(intoJapanese), [...baseline.map((line) => stripTerminalSequences(line)), "あ"]);
	assert.ok(intoJapanese[2]?.startsWith(RED));

	const ansiOnlyLine = wrapProseText(`${RED}\nこれは日本語です。${RESET}`, 8);
	assert.deepEqual(plain(ansiOnlyLine), ["", "これは日", "本語で", "す。"]);
	assert.ok(ansiOnlyLine[1]?.startsWith(RED));

	const inheritedColon = wrapProseText("\x1b[4:3mあ\nabcdefg.\x1b[0m", 7);
	assert.deepEqual(plain(inheritedColon), ["あ", "abcdefg", "."]);
	assert.ok(inheritedColon[1]?.startsWith("\x1b[4:3m"));
	assert.ok(inheritedColon[2]?.startsWith("\x1b[4:3m"));
});

test("a protected span after an opening mark backtracks to a legal boundary", () => {
	assert.deepEqual(wrapProseText("ああ（abc）", 8, [{ start: 3, end: 6 }]), ["ああ", "（abc）"]);
});

test("colon SGR subparameters preserve underline style and colon colors", () => {
	const expected = ["これは日", "本語で", "す。"];
	const curly = wrapProseText("\x1b[4:3mこれは日本語です。\x1b[0m", 8);
	assert.deepEqual(plain(curly), expected);
	assert.ok(curly[0]?.startsWith("\x1b[4:3m"));
	assert.ok(curly[1]?.startsWith("\x1b[4:3m"));
	assert.ok(curly[2]?.startsWith("\x1b[4:3m"));
	assert.ok(!curly.some((line) => line.includes("\x1b[3;4m")));

	const double = wrapProseText("\x1b[4:2mこれは日本語です。\x1b[0m", 8);
	assert.deepEqual(plain(double), expected);
	assert.ok(double[1]?.startsWith("\x1b[4:2m"));

	const colonRgb = wrapProseText("\x1b[4:3;38:2::1:2:3;48:5:236mこれは日本語です。\x1b[0m", 8);
	assert.deepEqual(plain(colonRgb), expected);
	for (const line of colonRgb.slice(0, 2)) {
		assert.ok(line.startsWith("\x1b[4:3;38:2::1:2:3;48:5:236m"));
	}

	const colonRgbWithColorspace = wrapProseText("\x1b[38:2:0:1:2:3mこれは日本語です。\x1b[0m", 8);
	assert.deepEqual(plain(colonRgbWithColorspace), expected);
	assert.ok(colonRgbWithColorspace[1]?.startsWith("\x1b[38:2:0:1:2:3m"));

	const semicolonRgbWithEmptyColorspace = wrapProseText("\x1b[38;2;;1;2;3mこれは日本語です。\x1b[0m", 8);
	assert.deepEqual(plain(semicolonRgbWithEmptyColorspace), expected);
	assert.ok(semicolonRgbWithEmptyColorspace[1]?.startsWith("\x1b[38;2;1;2;3m"));

	const cleared = wrapProseText("\x1b[4:0;3mこれは日本語です。\x1b[0m", 8);
	assert.deepEqual(plain(cleared), expected);
	assert.ok(cleared[1]?.startsWith("\x1b[3m"));
	assert.ok(!cleared[1]?.includes("\x1b[4m"));
});

test("an empty SGR parameter resets attributes instead of reopening the prior color", () => {
	const expected = ["これは日", "本語で", "す。"];
	const lines = wrapProseText("\x1b[31;mこれは日本語です。\x1b[0m", 8);
	assert.deepEqual(plain(lines), expected);
	assert.ok(!lines[1]?.includes("\x1b[31m"));
	assert.ok(!lines[2]?.includes("\x1b[31m"));
});

test("ANSI colors, underline, and background close and reopen at generated breaks", () => {
	const redLines = wrapProseText(`${RED}これは日本語です。${RESET}`, 8);
	assert.deepEqual(plain(redLines), ["これは日", "本語で", "す。"]);
	assert.ok(redLines[0].startsWith("\u001b[31m"));
	assert.ok(redLines[0].endsWith("\u001b[0m"));
	assert.ok(redLines[1].startsWith("\u001b[31m"));

	const underlineLines = wrapProseText(`${UNDERLINE}これは日本語です。${UNDERLINE_OFF}`, 8);
	assert.deepEqual(plain(underlineLines), ["これは日", "本語で", "す。"]);
	assert.ok(underlineLines[0].endsWith("\u001b[0m"));
	assert.ok(underlineLines[1].startsWith("\u001b[4m"));
	assert.ok(underlineLines[2].endsWith("\u001b[24m"));

	const backgroundLines = wrapProseText(`${BACKGROUND}これは日本語です。${BACKGROUND_OFF}`, 8);
	assert.deepEqual(plain(backgroundLines), ["これは日", "本語で", "す。"]);
	assert.ok(backgroundLines[1].startsWith("\u001b[48;5;236m"));

	const combined = "\u001b[1;4;38;5;196;48;2;1;2;3mこれは日本語です。\u001b[0m";
	const combinedLines = wrapProseText(combined, 8);
	assert.deepEqual(plain(combinedLines), ["これは日", "本語で", "す。"]);
	for (const line of combinedLines.slice(0, -1)) {
		assert.ok(line.endsWith("\u001b[0m"));
		assert.ok(line.startsWith("\u001b[1;4;38;5;196;48;2;1;2;3m"));
	}
});

test("OSC 8 links stay clickable on every wrapped line", () => {
	const lines = wrapProseText(`${OSC8_OPEN}これは日本語です。${OSC8_CLOSE}`, 8);
	assert.deepEqual(plain(lines), ["これは日", "本語で", "す。"]);
	for (const line of lines) {
		assert.equal(getOsc8LinkAtColumn(line, 0), "https://example.com/日本語");
		assert.ok(line.endsWith("\u001b]8;;\u001b\\"));
	}
});

test("combining marks, emoji, and ANSI inside a grapheme are never split", () => {
	const combining = wrapProseText("e\u0301e\u0301e\u0301e\u0301e\u0301", 2);
	assert.deepEqual(plain(combining), ["e\u0301e\u0301", "e\u0301e\u0301", "e\u0301"]);
	assert.ok(combining.every((line) => visibleWidth(line) <= 2));

	const emoji = wrapProseText("👩‍💻👩‍💻👩‍💻", 2);
	assert.deepEqual(plain(emoji), ["👩‍💻", "👩‍💻", "👩‍💻"]);
	assert.ok(emoji.every((line) => visibleWidth(line) === 2));

	const ansiInside = wrapProseText(`e${RED}\u0301x`, 2);
	assert.equal(plain(ansiInside).join(""), "e\u0301x");
	assert.ok(ansiInside.every((line) => visibleWidth(line) <= 2));

	const mixedCombining = wrapProseText("あe\u0301e\u0301e\u0301", 2);
	assert.equal(plain(mixedCombining).join(""), "あe\u0301e\u0301e\u0301");
	assert.ok(mixedCombining.every((line) => visibleWidth(line) <= 2));

	const mixedEmoji = wrapProseText("あ👩‍💻👩‍💻", 2);
	assert.equal(plain(mixedEmoji).join(""), "あ👩‍💻👩‍💻");
	assert.ok(mixedEmoji.every((line) => visibleWidth(line) <= 2));

	const mixedAnsiInside = wrapProseText(`あe${RED}\u0301x`, 2);
	assert.equal(plain(mixedAnsiInside).join(""), "あe\u0301x");
	assert.ok(mixedAnsiInside.every((line) => visibleWidth(line) <= 2));
});

test("narrow widths preserve content and only overflow an indivisible grapheme", () => {
	const text = "これは日本語です。";
	for (let width = 1; width <= 8; width++) {
		const lines = wrapProseText(text, width);
		assert.equal(plain(lines).join(""), text, `content at ${width}`);
		for (const line of lines) {
			assert.ok(visibleWidth(line) <= Math.max(width, 2), `line width at ${width}: ${JSON.stringify(line)}`);
		}
	}
});

test("ANSI resets attached to spaces are preserved at explicit and generated breaks", () => {
	const red = "\x1b[31m";
	const reset = "\x1b[0m";
	assert.deepEqual(wrapProseText(`${red}赤 ${reset}\n次`, 8), [`${red}赤 ${reset}`, "次"]);
	assert.deepEqual(wrapProseText(`${red}赤 ${reset}次`, 3), [`${red}赤 ${reset}`, "次"]);
});

test("explicit newlines and blank lines are preserved", () => {
	assert.deepEqual(wrapProseText("これは日本語です。\n\n次の行です。", 8), [
		"これは日",
		"本語で",
		"す。",
		"",
		"次の行で",
		"す。",
	]);
	assert.deepEqual(wrapProseText("first\n\nsecond", 8), ["first", "", "second"]);
	assert.deepEqual(wrapProseText("first\n", 8), ["first", ""]);
	assert.deepEqual(wrapProseText(`${UNDERLINE}これは\n   \nです。${UNDERLINE_OFF}`, 8), [
		`${UNDERLINE}これは${RESET}`,
		"",
		`${UNDERLINE}です。${UNDERLINE_OFF}`,
	]);
});

test("underline state is closed at an explicit newline and reopened after a blank line", () => {
	const lines = wrapProseText(`${UNDERLINE}これは日本語です。\n\n次の行です。${UNDERLINE_OFF}`, 8);
	assert.deepEqual(plain(lines), ["これは日", "本語で", "す。", "", "次の行で", "す。"]);
	assert.ok(lines[2].endsWith("\u001b[0m"));
	assert.equal(lines[3], "");
	assert.ok(lines[4].startsWith("\u001b[4m"));
});

test("protected spans keep inline code, math, and short URLs intact", () => {
	const code = "これは`コード`です。";
	const codeLines = wrapProseText(code, 8, [{ start: 3, end: 8 }]);
	assert.deepEqual(codeLines, ["これは", "`コード`", "です。"]);

	const math = "これはx² + y²です。";
	const mathLines = wrapProseText(math, 8, [{ start: 3, end: 10 }]);
	assert.deepEqual(mathLines, ["これは", "x² + y²", "です。"]);

	const url = "これは https://a.co です";
	const urlLines = wrapProseText(url, 14, [{ start: 4, end: 16 }]);
	assert.deepEqual(urlLines, ["これは", "https://a.co", "です"]);

	const spacedCode = "これは` foo`です。";
	const spacedCodeLines = wrapProseText(spacedCode, 8, [{ start: 3, end: 9 }]);
	assert.deepEqual(spacedCodeLines, ["これは", "` foo`で", "す。"]);

	const mixed = "hello\nこれは`コード`です。";
	const mixedLines = wrapProseText(mixed, 8, [{ start: 9, end: 14 }]);
	assert.deepEqual(mixedLines, ["hello", "これは", "`コード`", "です。"]);
});

test("a protected span wider than the column is split at grapheme boundaries only", () => {
	const code = "これは`とても長いコード`です。";
	const lines = wrapProseText(code, 8, [{ start: 3, end: 13 }]);
	for (const line of lines) {
		assert.ok(visibleWidth(line) <= 8, JSON.stringify(line));
	}
	assert.equal(plain(lines).join(""), code);
});

test("literal-heavy protected spans map in one pass", { timeout: 5000 }, () => {
	const count = 100_000;
	const text = "あ".repeat(count);
	const spans = Array.from({ length: count }, (_, index) => ({ start: index, end: index + 1 }));
	const lines = wrapProseText(text, 80, spans);
	assert.equal(plain(lines).join(""), text);
	assert.equal(lines.length, Math.ceil(count / 40));
});
