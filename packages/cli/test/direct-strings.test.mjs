import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const cliRoot = fileURLToPath(new URL("..", import.meta.url));
const repoRoot = resolve(cliRoot, "..", "..");
const script = join(repoRoot, "scripts", "check-direct-strings.mjs");

/** Build `${name}` as fixture text without writing a template placeholder in this file. */
const interpolation = (name) => "$" + "{" + name + "}";

/**
 * Run the detector against a throwaway source tree. The fixture root mirrors
 * the real layout so the default scan finds `packages/cli/src/**`.
 */
function runDetector({ files = {}, allowlist = [] } = {}) {
	const root = mkdtempSync(join(tmpdir(), "direct-strings-"));
	try {
		for (const [relativePath, source] of Object.entries(files)) {
			const path = join(root, relativePath);
			mkdirSync(dirname(path), { recursive: true });
			writeFileSync(path, source);
		}
		const allowlistPath = join(root, "allowlist.json");
		writeFileSync(allowlistPath, JSON.stringify(allowlist, null, 2));
		return spawnSync(process.execPath, [script, "--root", root, "--allowlist", allowlistPath], {
			encoding: "utf8",
		});
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

const SOURCE = "packages/cli/src/sample.ts";

test("a direct console.log string literal fails the check", () => {
	const result = runDetector({ files: { [SOURCE]: 'console.log("Hello, user");\n' } });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /direct string/u);
	assert.match(result.stdout, /Hello, user/u);
});

test("a direct console.error template with words fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: "console.error(`Jouzu warning: " + interpolation("message") + "`);\n" },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /Jouzu warning/u);
});

test("a CommandReport entry without a catalog ID fails the check", () => {
	const result = runDetector({
		files: {
			[SOURCE]: 'const notes = [{ status: "warning", key: "source", message: "The source is stale." }];\n',
		},
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /report-entry/u);
	assert.match(result.stdout, /The source is stale/u);
});

test("a report entry resolved from the catalog is not reported", () => {
	const result = runDetector({
		files: {
			[SOURCE]:
				'const notes = [{ status: "warning", key: "source", message: catalogText(catalog, CatalogMessageId.catalogWarning) }];\n',
		},
	});
	assert.equal(result.status, 0);
	assert.match(result.stdout, /0 direct string/u);
});

test("a doctor warning message literal fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: 'warning("provider.unconfigured", "No obvious provider was found");\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /warning-message/u);
	assert.match(result.stdout, /No obvious provider/u);
});

test("a doctor warning template with words fails the check", () => {
	const result = runDetector({
		files: {
			[SOURCE]: `warning("catalog.statusUnavailable", \`Catalog status is unavailable: ${interpolation("diagnostic")}\`);\n`,
		},
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /warning-message/u);
	assert.match(result.stdout, /Catalog status is unavailable/u);
});

test("a warning resolved from the catalog is not reported", () => {
	const result = runDetector({
		files: {
			[SOURCE]:
				'warning("provider.unconfigured", catalogText(catalog, CatalogMessageId.doctorWarningProviderUnconfigured));\n',
		},
	});
	assert.equal(result.status, 0);
});

test("a warning whose message is a variable or member expression is not reported", () => {
	const result = runDetector({
		files: {
			[SOURCE]: 'warning("packages.invalid", packageState.warning);\nwarning("x", context.diagnostic);\n',
		},
	});
	assert.equal(result.status, 0);
});

test("a warning whose message is a concatenation of protected values is not reported", () => {
	const result = runDetector({ files: { [SOURCE]: 'warning("id", prefix + suffix);\n' } });
	assert.equal(result.status, 0);
});

test("a doctor problem message literal fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: 'problem("git.missing", "Git was not found on PATH");\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /problem-message/u);
	assert.match(result.stdout, /Git was not found/u);
});

test("a doctor problem template with words fails the check", () => {
	const result = runDetector({
		files: {
			[SOURCE]: `problem("node.unsupported", \`Node ${interpolation("version")} is unsupported\`);\n`,
		},
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /problem-message/u);
	assert.match(result.stdout, /is unsupported/u);
});

test("a problem resolved from the catalog is not reported", () => {
	const result = runDetector({
		files: {
			[SOURCE]: 'problem("git.missing", catalogText(catalog, CatalogMessageId.doctorProblemGitMissing));\n',
		},
	});
	assert.equal(result.status, 0);
});

test("a problem whose message is a variable or member expression is not reported", () => {
	const result = runDetector({
		files: { [SOURCE]: 'problem("x", context.diagnostic);\nproblem("y", diagnostic);\n' },
	});
	assert.equal(result.status, 0);
});

test("a problem whose message is a concatenation of protected values is not reported", () => {
	const result = runDetector({ files: { [SOURCE]: 'problem("id", prefix + suffix);\n' } });
	assert.equal(result.status, 0);
});

test("a console call with a non-literal value is not reported", () => {
	const result = runDetector({ files: { [SOURCE]: "console.log(message);\nconsole.error(error);\n" } });
	assert.equal(result.status, 0);
});

test("a --json branch is not reported", () => {
	const result = runDetector({
		files: { [SOURCE]: "console.log(parsed.json ? JSON.stringify(result, null, 2) : formatStatus(result));\n" },
	});
	assert.equal(result.status, 0);
});

test("a template with no static words is not a false positive", () => {
	const result = runDetector({ files: { [SOURCE]: "console.log(`" + interpolation("path") + "`);\n" } });
	assert.equal(result.status, 0);
});

test("a blank or whitespace-only literal is not reported", () => {
	const result = runDetector({ files: { [SOURCE]: 'console.log("");\nconsole.log("   ");\nconsole.log("\\n");\n' } });
	assert.equal(result.status, 0);
});

test("a separator-only literal is reported and passes when allowlisted", () => {
	const files = { [SOURCE]: 'console.log("·");\n' };
	const withoutReason = runDetector({ files });
	assert.equal(withoutReason.status, 1);
	const entry = {
		file: SOURCE,
		kind: "console-literal",
		text: "·",
		category: "blank-or-separator",
		reason: "Renders the report separator glyph only; it carries no words to translate.",
	};
	const allowed = runDetector({ files, allowlist: [entry] });
	assert.equal(allowed.status, 0, allowed.stderr);
});

test("a protected-value-only report entry is reported and passes when allowlisted", () => {
	const files = {
		[SOURCE]:
			'const notes = [{ status: "problem", key: "x", message: `' +
			interpolation("code") +
			": " +
			interpolation("detail") +
			"` }];\n",
	};
	const withoutReason = runDetector({ files });
	assert.equal(withoutReason.status, 1);
	assert.match(withoutReason.stdout, /report-entry/u);
	const entry = {
		file: SOURCE,
		kind: "report-entry",
		text: "{…}: {…}",
		category: "protected-values",
		reason: "Prints an error code and a source message; both are protected values.",
	};
	const allowed = runDetector({ files, allowlist: [entry] });
	assert.equal(allowed.status, 0, allowed.stderr);
});

test("an allowlisted literal passes and a stale allowlist entry fails", () => {
	const files = { [SOURCE]: 'console.log("Allowed because it is a protected value: model-id");\n' };
	const entry = {
		file: SOURCE,
		kind: "console-literal",
		text: "Allowed because it is a protected value: model-id",
		category: "protected-values",
		reason: "Prints one model identifier that must stay byte-identical for the user to copy.",
	};
	const allowed = runDetector({ files, allowlist: [entry] });
	assert.equal(allowed.status, 0, allowed.stderr);

	const stale = runDetector({
		files: { [SOURCE]: 'console.log("Some other string");\n' },
		allowlist: [entry],
	});
	assert.equal(stale.status, 1);
	assert.match(stale.stderr, /stale allowlist entry/u);
});

test("an allowlist entry without a real reason is rejected", () => {
	const result = runDetector({
		files: { [SOURCE]: 'console.log("Hello, user");\n' },
		allowlist: [
			{
				file: SOURCE,
				kind: "console-literal",
				text: "Hello, user",
				category: "protected-values",
				reason: "ok",
			},
		],
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /reason is too short/u);
});

test("a pending-migration allowlist entry must link to a public issue", () => {
	const result = runDetector({
		files: { [SOURCE]: 'console.log("Hello, user");\n' },
		allowlist: [
			{
				file: SOURCE,
				kind: "console-literal",
				text: "Hello, user",
				category: "pending-migration",
				reason: "This string is still direct and someone will migrate it eventually.",
			},
		],
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /link to a public issue/u);
});

test("a product-name allowlist entry must name the decision date", () => {
	const result = runDetector({
		files: { [SOURCE]: 'const view = { view: "models", label: "Models" };\n' },
		allowlist: [
			{
				file: SOURCE,
				kind: "label-property",
				text: "Models",
				category: "product-name",
				reason: "The Palette view name is kept English as a product noun by the owner decision.",
			},
		],
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /decision date/u);
});

test("an upstream-mirror allowlist entry must name the upstream owner", () => {
	const result = runDetector({
		files: { [SOURCE]: 'const entry = { label: "Fetch URL" };\n' },
		allowlist: [
			{
				file: SOURCE,
				kind: "label-property",
				text: "Fetch URL",
				category: "upstream-mirror",
				reason: "This label mirrors a value that the upstream package renders unchanged.",
			},
		],
	});
	assert.equal(result.status, 1);
	assert.match(result.stderr, /upstream owner/u);
});

test("a label property with a literal value is reported", () => {
	const result = runDetector({ files: { [SOURCE]: 'const hints = [{ key: confirm, label: "save" }];\n' } });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /label-property/u);
	assert.match(result.stdout, /save/u);
});

test("a label property whose value is a catalog call is not reported", () => {
	const result = runDetector({
		files: { [SOURCE]: 'const hints = [{ key: confirm, label: catalogText("palette.hint.save") }];\n' },
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a description property is not reported, because it is model-facing text", () => {
	const result = runDetector({
		files: { [SOURCE]: 'const tool = { name: "fetch", description: "Fetch a URL and return its text." };\n' },
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a ctx.ui.notify message literal fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: 'ctx.ui.notify("Catalog settings require interactive TUI mode.");\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /notify-argument/u);
	assert.match(result.stdout, /interactive TUI mode/u);
});

test("an optional-chain ui.notify message is reported", () => {
	const result = runDetector({ files: { [SOURCE]: 'activeCtx?.ui.notify("Something went wrong here.");\n' } });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /notify-argument/u);
});

test("notify on a receiver that does not end in ui is not reported", () => {
	const result = runDetector({ files: { [SOURCE]: 'active.notify("Some message here");\n' } });
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a notify argument that fails the prose test is not reported", () => {
	const result = runDetector({ files: { [SOURCE]: 'ctx.ui.notify("model-id");\n' } });
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a UsageError constructor literal fails the check", () => {
	const result = runDetector({ files: { [SOURCE]: 'throw new UsageError("The catalog is unavailable.");\n' } });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /error-argument/u);
	assert.match(result.stdout, /catalog is unavailable/u);
});

test("a CatalogError constructor literal fails the check", () => {
	const result = runDetector({ files: { [SOURCE]: 'throw new CatalogError("The catalog response stalled.");\n' } });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /error-argument/u);
});

test("a plain Error constructor is not reported by the error shape", () => {
	const result = runDetector({ files: { [SOURCE]: 'throw new Error("The catalog is unavailable.");\n' } });
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a conditional branch literal fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: 'const label = paused ? "Resume automation" : "Pause automation";\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /conditional-branch/u);
	assert.match(result.stdout, /Resume automation/u);
	assert.match(result.stdout, /Pause automation/u);
});

test("a variable initializer literal fails the check", () => {
	const result = runDetector({ files: { [SOURCE]: 'const message = "Something went wrong here.";\n' } });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /variable-literal/u);
	assert.match(result.stdout, /Something went wrong here/u);
});

test("a nullish fallback literal fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: 'const label = runtime.about() ?? "Runtime diagnostics are unavailable.";\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /fallback-branch/u);
	assert.match(result.stdout, /Runtime diagnostics are unavailable/u);
});

test("a logical-or fallback literal fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: 'const summary = content || "Message with non-text content";\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /fallback-branch/u);
	assert.match(result.stdout, /Message with non-text content/u);
});

test("a fallback whose right operand is not a literal is not reported", () => {
	const result = runDetector({
		files: {
			[SOURCE]:
				"const a = first ?? second;\nconst b = name || catalogText(catalog, CatalogMessageId.modelPickerEmpty);\n",
		},
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("an assignment to a declared variable fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: 'let warning;\nwarning = "Admission revalidated.";\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /assignment-literal/u);
	assert.match(result.stdout, /Admission revalidated/u);
});

test("a declaration initializer keeps the variable-literal kind", () => {
	const result = runDetector({ files: { [SOURCE]: 'const message = "Something went wrong here.";\n' } });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /variable-literal/u);
	assert.doesNotMatch(result.stdout, /assignment-literal/u);
});

test("an assignment to a member expression is not the assignment shape", () => {
	const result = runDetector({
		files: { [SOURCE]: 'row.label = "Catalog settings require interactive TUI mode.";\n' },
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a record value literal fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: 'const state = { notice: "The catalog is unavailable." };\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /record-value/u);
	assert.match(result.stdout, /catalog is unavailable/u);
});

test("a non-UI record value is not reported", () => {
	const result = runDetector({
		files: {
			[SOURCE]:
				'const state = { content: "Hello there, user.", path: "/usr/local/bin", url: "https://example.com/x" };\n',
		},
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("the prose filter rejects protected values in a record", () => {
	const result = runDetector({
		files: {
			[SOURCE]:
				'const state = { a: "catalog.warning", b: "model-id", c: "CATALOG_WARNING", d: "https://example.com/x", e: "config.json", f: "12345", g: "ab" };\n',
		},
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a single capitalized word passes the prose test", () => {
	const result = runDetector({ files: { [SOURCE]: 'const state = { notice: "Warning:" };\n' } });
	assert.equal(result.status, 1);
	assert.match(result.stdout, /record-value/u);
});

test("a report entry message keeps report-entry over record-value", () => {
	const result = runDetector({
		files: {
			[SOURCE]: 'const notes = [{ status: "warning", key: "source", message: "The source is stale." }];\n',
		},
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /report-entry/u);
	assert.doesNotMatch(result.stdout, /record-value/u);
});

test("a styles.apply prose literal fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: 'const row = styles.apply("palette.empty", "No sources configured.");\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /apply-argument/u);
	assert.match(result.stdout, /No sources configured/u);
});

test("a styles.apply template with static words fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: "const title = styles.apply('palette.title', `· Workflow" + interpolation("stage") + "`);\n" },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /apply-argument/u);
	assert.match(result.stdout, /Workflow/u);
});

test("a decorative styles.apply literal is reported and passes when allowlisted", () => {
	const files = { [SOURCE]: 'const marker = styles.apply("palette.marker", "→");\n' };
	const withoutReason = runDetector({ files });
	assert.equal(withoutReason.status, 1);
	assert.match(withoutReason.stdout, /apply-argument/u);
	assert.match(withoutReason.stdout, /→/u);
	const entry = {
		file: SOURCE,
		kind: "apply-argument",
		text: "→",
		category: "blank-or-separator",
		reason: "Renders the selected-row marker glyph; a decorative arrow with no words to translate.",
	};
	const allowed = runDetector({ files, allowlist: [entry] });
	assert.equal(allowed.status, 0, allowed.stderr);
});

test("a styles.apply call whose value is not a literal is not reported", () => {
	const result = runDetector({
		files: {
			[SOURCE]:
				"const styled = styles.apply(role, value);\nconst other = styles.apply(role, catalogText(catalog, id));\n",
		},
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("an apply property on another receiver is still reported", () => {
	const result = runDetector({
		files: { [SOURCE]: 'const styled = row.apply("palette.value", "No sources configured.");\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /apply-argument/u);
});

test("a local notify helper prose literal fails the check", () => {
	const result = runDetector({
		files: { [SOURCE]: 'notify(ctx, "Catalog settings require interactive TUI mode.");\n' },
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /notify-helper-argument/u);
	assert.match(result.stdout, /interactive TUI mode/u);
});

test("a local notify helper template with static words fails the check", () => {
	const result = runDetector({
		files: {
			[SOURCE]: "notify(ctx, `TextGuard: " + interpolation("count") + " items waiting for your review.`);\n",
		},
	});
	assert.equal(result.status, 1);
	assert.match(result.stdout, /notify-helper-argument/u);
	assert.match(result.stdout, /waiting for your review/u);
});

test("a notify helper whose message is not a literal is not reported", () => {
	const result = runDetector({
		files: {
			[SOURCE]: 'notify(ctx, message, "info");\nnotify(ctx, catalogText(catalog, id));\n',
		},
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a notify helper argument that fails the prose test is not reported", () => {
	const result = runDetector({ files: { [SOURCE]: 'notify(USAGE, "error");\n' } });
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("a same-named notify method on a receiver is not confused with the bare helper", () => {
	const result = runDetector({
		files: { [SOURCE]: 'row.notify(ctx, "Catalog settings require interactive TUI mode.");\n' },
	});
	assert.equal(result.status, 0, result.stdout + result.stderr);
});

test("the real tree has no unallowlisted direct string", () => {
	const result = spawnSync(process.execPath, [script], { cwd: repoRoot, encoding: "utf8" });
	assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
	assert.match(result.stdout, /all allowlisted \(\d+ entries with a reason\)/u);
});
