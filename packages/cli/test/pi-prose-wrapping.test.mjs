import assert from "node:assert/strict";
import { test } from "node:test";
import { resolvePiProseWrappingRuntime, withPiProseWrapping } from "../dist/pi-prose-wrapping.js";
import {
	getOsc8LinkAtColumn,
	Markdown,
	resetCapabilitiesCache,
	setCapabilityOverrides,
	stripTerminalSequences,
	Text,
} from "../node_modules/@earendil-works/pi-tui/dist/index.js";

const theme = {
	heading: (text) => `\u001b[1m${text}\u001b[22m`,
	link: (text) => `\u001b[4m${text}\u001b[24m`,
	linkUrl: (text) => `\u001b[2m${text}\u001b[22m`,
	code: (text) => `\u001b[36m${text}\u001b[39m`,
	codeBlock: (text) => text,
	codeBlockBorder: (text) => text,
	quote: (text) => `\u001b[3m${text}\u001b[23m`,
	quoteBorder: (text) => text,
	hr: (text) => text,
	listBullet: (text) => text,
	bold: (text) => `\u001b[1m${text}\u001b[22m`,
	italic: (text) => `\u001b[3m${text}\u001b[23m`,
	strikethrough: (text) => text,
	underline: (text) => text,
};

function render(markdown, width) {
	return new Markdown(markdown, 0, 0, theme).render(width);
}

function textLines(lines) {
	return lines.map((line) => stripTerminalSequences(line).trimEnd());
}

test("the resolver selects the pi-tui copy used by the conversation renderer", async () => {
	const resolved = await resolvePiProseWrappingRuntime();
	assert.equal(resolved.markdown, Markdown);
	assert.equal(typeof resolved.metrics.visibleWidth, "function");
});

test("the adapter wraps conversation prose and restores Pi's renderer", async () => {
	const original = Markdown.prototype.renderToken;
	const originalRender = Markdown.prototype.render;
	const baseline = render("これは日本語です。", 16);
	assert.deepEqual(textLines(baseline), ["これは日本語です", "。"]);

	const wrapped = await withPiProseWrapping(() => render("これは日本語です。", 16));
	assert.deepEqual(textLines(wrapped), ["これは日本語で", "す。"]);
	const narrow = await withPiProseWrapping(() => render("これは日本語です。", 8));
	assert.deepEqual(textLines(narrow), ["これは日", "本語で", "す。"]);
	assert.equal(Markdown.prototype.renderToken, original);
	assert.equal(Markdown.prototype.render, originalRender);

	const restored = render("これは日本語です。", 16);
	assert.deepEqual(restored, baseline);
});

test("non-Japanese Markdown is byte-identical to baseline", async () => {
	const cases = [
		["a `b c`", 4],
		["abcdefg.", 7],
		["hello   ", 8],
		["hello   world", 8],
		["plain English prose", 6],
	];
	for (const [document, width] of cases) {
		const baseline = render(document, width);
		const wrapped = await withPiProseWrapping(() => render(document, width));
		assert.deepEqual(wrapped, baseline, `${document} at ${width}`);
	}
});

test("mixed single-paragraph prose delegates the English line to baseline", async () => {
	const baselineEnglish = textLines(render("abcdefg.", 7));
	const lines = textLines(await withPiProseWrapping(() => render("あ  \nabcdefg.", 7)));
	assert.deepEqual(lines, ["あ", ...baselineEnglish]);
});

test("inline code after an opening mark backtracks to a legal boundary", async () => {
	const lines = textLines(await withPiProseWrapping(() => render("ああ（`abc`）", 8)));
	assert.deepEqual(lines, ["ああ", "（abc）"]);
});

test("headings, lists, blockquotes, and nested structures keep their prefixes", async () => {
	const document = [
		"### これは見出しです。",
		"",
		"- これはリストの日本語です。",
		"  - これは入れ子の日本語です。",
		"",
		"> これは引用の日本語です。",
		">",
		"> > これは入れ子の引用です。",
		"",
	].join("\n");
	const lines = textLines(await withPiProseWrapping(() => render(document, 14)));
	assert.ok(lines.includes("### これは見出"));
	assert.ok(lines.includes("しです。"));
	assert.ok(lines.some((line) => line.startsWith("- これはリスト")));
	assert.ok(lines.some((line) => line.startsWith("    - これは入")));
	assert.ok(lines.some((line) => line.startsWith("│ これは引用の")));
	assert.ok(lines.some((line) => line.startsWith("│ │ これは入れ")));
	for (const line of lines) {
		const content = line.replace(/^[│\s]*(?:[-*] |\d+[.)] )?/u, "");
		assert.ok(!/^[、。，．：；？！）］｝」』】]/u.test(content), `prohibited start: ${JSON.stringify(line)}`);
	}
});

test("inline literals inside headings and list items stay intact", async () => {
	const document = ["### これは`コード`です。", "", "- これは`コード`です。"].join("\n");
	const lines = textLines(await withPiProseWrapping(() => render(document, 10)));
	assert.ok(lines.includes("### これは"));
	assert.ok(lines.includes("- これは"));
	assert.ok(lines.includes("コードで"));
	assert.ok(lines.includes("  コードで"));
});

test("generic Text rendering is unchanged", async () => {
	const text = new Text("これは日本語です。", 0, 0);
	const baseline = text.render(8);
	const during = await withPiProseWrapping(() => text.render(8));
	assert.deepEqual(during, baseline);
});

test("code blocks and tables are byte-identical with and without the adapter", async () => {
	const documents = [
		["code", "```js\nconst これは日本語です。 = 1;\nこれはとても長い日本語のコード行です。\n```\n", 10],
		["table", "| これは日本語です。 | b |\n|---|---|\n| あ | これはとても長い日本語です。 |\n", 16],
		["both", "```js\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| これは日本語です。 | あ |\n", 16],
	];
	for (const [name, document, width] of documents) {
		const baseline = render(document, width);
		const wrapped = await withPiProseWrapping(() => render(document, width));
		assert.deepEqual(wrapped, baseline, name);
	}
});

test("code nested in lists and blockquotes is unchanged", async () => {
	const document = [
		"- これはリストの日本語です。",
		"",
		"  ```js",
		"  const これはコードです。 = 1;",
		"  ```",
		"",
		"> これは引用の日本語です。",
		">",
		"> ```js",
		"> const これは引用コードです。 = 1;",
		"> ```",
		"",
	].join("\n");
	const baseline = render(document, 24);
	const wrapped = await withPiProseWrapping(() => render(document, 24));
	const codeLines = (lines) =>
		lines.map((line) => stripTerminalSequences(line).trimEnd()).filter((line) => line.includes("const "));
	assert.deepEqual(codeLines(wrapped), codeLines(baseline));
	assert.ok(textLines(wrapped).includes("│ これは引用の日本語で"));
});

test("inline code, inline math, and link labels are wrapped without breaking literals", async () => {
	setCapabilityOverrides({ hyperlinks: true });
	try {
		const document = [
			"これは`コード`です。",
			"",
			"これは$x^2 + y^2$です。",
			"",
			"[これはリンクの日本語です。](https://a.co)",
			"",
		].join("\n");
		const lines = await withPiProseWrapping(() => render(document, 8));
		const text = textLines(lines);
		assert.ok(text.includes("コードで"));
		assert.ok(text.includes("x² + y²"));
		assert.ok(text.includes("これはリ"));
		const linkLines = lines.filter((line) => stripTerminalSequences(line).trim() !== "");
		for (const line of linkLines) {
			if (line.includes("\u001b]8;")) assert.equal(getOsc8LinkAtColumn(line, 0), "https://a.co");
		}
		assert.ok(linkLines.filter((line) => line.includes("\u001b]8;")).length >= 3);
	} finally {
		resetCapabilitiesCache();
		setCapabilityOverrides({});
	}
});

test("URL-shaped link labels and displayed URLs stay intact", async () => {
	setCapabilityOverrides({ hyperlinks: false });
	try {
		const labelLines = textLines(
			await withPiProseWrapping(() => render("詳細は[https://a.co](https://a.co)です。", 12)),
		);
		assert.ok(labelLines.includes("https://a.co"));

		const hrefLines = textLines(await withPiProseWrapping(() => render("詳細は[リンク](https://a.co)です。", 12)));
		assert.ok(hrefLines.includes("https://a.co"));
	} finally {
		resetCapabilitiesCache();
		setCapabilityOverrides({});
	}
});

test("resizing and streaming reuse one Markdown instance without stale wrapping", async () => {
	await withPiProseWrapping(() => {
		const markdown = new Markdown("これは日本語です。", 0, 0, theme);
		assert.equal(textLines(markdown.render(16)).length, 2);
		assert.equal(textLines(markdown.render(8)).length, 3);
		assert.equal(textLines(markdown.render(16)).length, 2);

		markdown.setText("これは日本語です。\n\n次の行です。");
		const streamed = textLines(markdown.render(8));
		assert.deepEqual(streamed, ["これは日", "本語で", "す。", "", "次の行で", "す。"]);

		markdown.setText("これは");
		assert.deepEqual(textLines(markdown.render(8)), ["これは"]);
		markdown.setText("これは日本語です。");
		assert.deepEqual(textLines(markdown.render(8)), ["これは日", "本語で", "す。"]);
	});
});

test("a Markdown instance rendered before the scope bypasses its baseline cache", async () => {
	const originalRender = Markdown.prototype.render;
	const markdown = new Markdown("これは日本語です。", 0, 0, theme);
	const baseline = textLines(markdown.render(16));
	assert.deepEqual(baseline, ["これは日本語です", "。"]);

	const during = await withPiProseWrapping(() => textLines(markdown.render(16)));
	assert.deepEqual(during, ["これは日本語で", "す。"]);
	assert.equal(Markdown.prototype.render, originalRender);
	assert.deepEqual(textLines(markdown.render(16)), baseline);
});

test("a Markdown instance rendered in the scope does not leak wrapped cache after restore", async () => {
	let markdown;
	await withPiProseWrapping(() => {
		markdown = new Markdown("これは日本語です。", 0, 0, theme);
		assert.deepEqual(textLines(markdown.render(16)), ["これは日本語で", "す。"]);
	});
	assert.deepEqual(textLines(markdown.render(16)), ["これは日本語です", "。"]);
});

test("nested scopes invalidate cached lines and restore baseline output", async () => {
	const markdown = new Markdown("これは日本語です。", 0, 0, theme);
	const wrapped = ["これは日本語で", "す。"];
	const baseline = ["これは日本語です", "。"];
	await withPiProseWrapping(async () => {
		assert.deepEqual(textLines(markdown.render(16)), wrapped);
		await withPiProseWrapping(() => {
			assert.deepEqual(textLines(markdown.render(16)), wrapped);
		});
		assert.deepEqual(textLines(markdown.render(16)), wrapped);
	});
	assert.deepEqual(textLines(markdown.render(16)), baseline);
});

test("dead render references are pruned in bounded batches", async () => {
	const OriginalWeakRef = globalThis.WeakRef;
	const refs = [];
	let derefs = 0;
	class TrackingWeakRef {
		target;
		dead = false;

		constructor(target) {
			this.target = target;
			refs.push(this);
		}

		deref() {
			if (this.target instanceof Markdown) {
				derefs++;
				return this.dead ? undefined : this.target;
			}
			return this.target;
		}
	}
	globalThis.WeakRef = TrackingWeakRef;
	try {
		await withPiProseWrapping(() => {
			// Each batch starts with 64 live entries, so the adaptive threshold remains
			// the 64-addition minimum.
			const batch = 64;
			const renderBatch = (count) => {
				for (let index = 0; index < count; index++) {
					new Markdown("これは日本語です。", 0, 0, theme).render(16);
				}
			};
			const instanceRefs = () => refs.filter((reference) => reference.target instanceof Markdown);
			renderBatch(batch);
			const firstBatch = instanceRefs();
			assert.equal(firstBatch.length, batch);
			for (const reference of firstBatch) reference.dead = true;

			const beforeSecondPrune = derefs;
			renderBatch(batch);
			assert.equal(derefs - beforeSecondPrune, batch * 2);

			for (const reference of instanceRefs().slice(batch)) reference.dead = true;
			const beforeThirdPrune = derefs;
			renderBatch(batch);
			assert.equal(derefs - beforeThirdPrune, batch * 2);
		});
	} finally {
		globalThis.WeakRef = OriginalWeakRef;
	}
});

test("all-live render references are pruned with linear cumulative scans", { timeout: 5000 }, async () => {
	const OriginalWeakRef = globalThis.WeakRef;
	const refs = [];
	let derefs = 0;
	class TrackingWeakRef {
		target;

		constructor(target) {
			this.target = target;
			refs.push(this);
		}

		deref() {
			if (this.target instanceof Markdown) {
				derefs++;
				return this.target;
			}
			return this.target;
		}
	}
	globalThis.WeakRef = TrackingWeakRef;
	try {
		await withPiProseWrapping(() => {
			const count = 2048;
			const scanSizes = [];
			let previousDerefs = 0;
			for (let index = 0; index < count; index++) {
				new Markdown("これは日本語です。", 0, 0, theme).render(16);
				if (derefs > previousDerefs) {
					scanSizes.push(derefs - previousDerefs);
					previousDerefs = derefs;
				}
			}
			const instanceRefs = refs.filter((reference) => reference.target instanceof Markdown);
			assert.equal(instanceRefs.length, count);
			// All-live cycles double the scan size; cumulative scans stay linear.
			assert.deepEqual(scanSizes, [64, 128, 256, 512, 1024, 2048]);
			assert.equal(derefs, 4032);
		});
	} finally {
		globalThis.WeakRef = OriginalWeakRef;
	}
});

test("nested installs share one wrapper and restore only after the outer scope", async () => {
	const original = Markdown.prototype.renderToken;
	const originalRender = Markdown.prototype.render;
	await withPiProseWrapping(async () => {
		const outerWrapper = Markdown.prototype.renderToken;
		const outerRender = Markdown.prototype.render;
		assert.notEqual(outerWrapper, original);
		assert.notEqual(outerRender, originalRender);
		await withPiProseWrapping(() => {
			assert.equal(Markdown.prototype.renderToken, outerWrapper);
			assert.equal(Markdown.prototype.render, outerRender);
		});
		assert.equal(Markdown.prototype.renderToken, outerWrapper);
		assert.equal(Markdown.prototype.render, outerRender);
	});
	assert.equal(Markdown.prototype.renderToken, original);
	assert.equal(Markdown.prototype.render, originalRender);
});

test("restoration leaves a foreign renderer in place", async () => {
	const original = Markdown.prototype.renderToken;
	const foreign = () => ["foreign"];
	try {
		await withPiProseWrapping(() => {
			Markdown.prototype.renderToken = foreign;
		});
		assert.equal(Markdown.prototype.renderToken, foreign);
	} finally {
		Markdown.prototype.renderToken = original;
	}
});

test("restoration leaves a foreign render in place", async () => {
	const original = Markdown.prototype.render;
	const foreign = () => ["foreign"];
	try {
		await withPiProseWrapping(() => {
			Markdown.prototype.render = foreign;
		});
		assert.equal(Markdown.prototype.render, foreign);
	} finally {
		Markdown.prototype.render = original;
	}
});

test("a throwing operation still restores Pi's renderer", async () => {
	const original = Markdown.prototype.renderToken;
	await assert.rejects(
		withPiProseWrapping(() => {
			throw new Error("operation failed");
		}),
		/operation failed/u,
	);
	assert.equal(Markdown.prototype.renderToken, original);
});

test("an unusable Markdown constructor leaves the operation unwrapped", async () => {
	class NotMarkdown {}
	assert.equal(await withPiProseWrapping(() => "ok", { Markdown: NotMarkdown }), "ok");
});

test("an injected Markdown constructor is patched instead of the default copy", async () => {
	class FakeMarkdown {
		options = {};
		renderToken(token) {
			return token.type === "paragraph" ? [token.text] : [];
		}
	}
	const fakeOriginal = FakeMarkdown.prototype.renderToken;
	const result = await withPiProseWrapping(
		() => new FakeMarkdown().renderToken({ type: "paragraph", text: "これは日本語です。" }, 8),
		{ Markdown: FakeMarkdown },
	);
	assert.deepEqual(result, ["これは日", "本語で", "す。"]);
	assert.equal(FakeMarkdown.prototype.renderToken, fakeOriginal);
});

test("literal-heavy paragraphs stay bounded", { timeout: 5000 }, async () => {
	const count = 30_000;
	const document = Array.from({ length: count }, (_, index) => `あ\`x${index}\`  `).join("\n");
	const lines = textLines(await withPiProseWrapping(() => render(document, 20)));
	assert.equal(lines.length, count);
	assert.equal(lines[0], "あx0");
	assert.equal(lines[count - 1], `あx${count - 1}`);
});
