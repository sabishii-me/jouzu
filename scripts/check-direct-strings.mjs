#!/usr/bin/env node

/**
 * Detect direct human-facing strings in Jouzu CLI source.
 *
 * ## Why this is a check script, not only a test
 *
 * The detection must run in `npm run check`, which is the gate CI and a
 * reviewer actually run. A test under `npm test` is a different gate and can
 * be skipped, so a test-only detector would not stop a new direct string from
 * landing. The script is still exercised by
 * `packages/cli/test/direct-strings.test.mjs`, which runs it against fixtures;
 * the test proves the detector works, and the `check` wiring makes it enforce.
 *
 * ## What it matches
 *
 * Thirteen shapes. The first four are the original set; the allowlist keys on
 * file, kind, and text, so their kinds and behaviour are unchanged. The last
 * nine widen the detector to the human-facing text the original four could not
 * see. A literal that more than one shape sees is reported once, under the
 * highest-precedence kind (see "Which kind a literal gets").
 *
 * 1. `console-literal`: a string literal, a no-substitution template, or a
 *    template expression passed directly to `console.log` or `console.error`,
 *    when the literal carries at least one non-whitespace static character. A
 *    template whose static parts are only interpolation or whitespace, such as
 *    `` `${path}` `` or `""`, is not a human string and is not reported.
 * 2. `report-entry`: a `CommandReport` entry object literal (it has `status`,
 *    `key`, and `message`) whose `message` is a string or template literal
 *    that carries at least one non-whitespace static character. A `message`
 *    that is a call (a catalog lookup), an identifier, or a member expression
 *    is not reported: the call already carries a catalog ID, and the other two
 *    are dynamic values the detector cannot resolve statically.
 * 3. `warning-message` / `problem-message`: a call to a doctor diagnostic
 *    helper, `warning(id, message)` or `problem(id, message)`, whose `message`
 *    argument (the second argument) is a string or template literal that
 *    carries at least one non-whitespace static character. The first argument
 *    is the diagnostic ID, a protected value, so it is not inspected. This
 *    shape exists because the doctor builds every diagnosis this way, and the
 *    two original shapes could not see those calls: the message was neither a
 *    `console` argument nor a report-entry field, so the doctor's English
 *    diagnoses passed the check silently. The kind records which helper the
 *    literal came from.
 * 4. `label-property`, `title-property`, `hint-property`, `text-property`,
 *    `placeholder-property`, `summary-property`: a `label`, `title`, `hint`,
 *    `text`, `placeholder`, or `summary` property in an object literal whose
 *    value is a string or template literal that carries at least one
 *    non-whitespace static character. This is the label-table shape,
 *    `{ key: confirm, label: "save" }`. It exists because the Jouzu-owned UI
 *    keeps its human text in label and key-hint tables rather than in a
 *    `console` call, so the first three shapes could not see it. `description`
 *    is deliberately not in this set: in this codebase it is mostly the tool
 *    description the model reads, which is not UI text. A UI-owned
 *    `description` field is not detected, so the migration gives that surface
 *    a catalog-ID type instead and the closure issue verifies it.
 * 5. `notify-argument`: the first argument of a call whose callee is a
 *    property access named `notify`, on a receiver whose source text ends in
 *    `ui`. It covers `ctx.ui.notify`, `active.ctx.ui.notify`,
 *    `context.ui.notify`, `active.ui.notify`, `ctx?.ui.notify`, and
 *    `activeCtx?.ui.notify`. The user-notification surface is not a `console`
 *    call and not a label table, so the original shapes could not see it.
 * 6. `error-argument`: the first argument of a `new` expression whose class
 *    name is `UsageError` or `CatalogError`. These errors reach the user as
 *    rendered text, but they were neither a `console` argument nor a label
 *    property.
 * 7. `conditional-branch`: either branch of a conditional expression. A
 *    literal chosen by a condition is still direct text, and the original
 *    shapes saw it only when it also sat at a `console` or label position.
 * 8. `variable-literal`: the initializer of a variable declaration. A literal
 *    assigned to a name is invisible to a purely positional shape; this shape
 *    reports it so the allowlist can record where it is rendered.
 * 9. `record-value`: the value of a property assignment whose property name is
 *    neither a label property nor a member of the non-UI set below. This is
 *    the general data-table shape, and it is the widest new shape: it catches
 *    the human text stored under a name the label list does not know.
 * 10. `apply-argument`: the second argument of a call whose callee is a
 *    property access named `apply`, when that argument is a string or template
 *    literal that carries at least one non-whitespace static character. The
 *    Palette styles seam, `styles.apply(role, value)`, takes arbitrary styled
 *    content, so its `value` parameter cannot be a catalog-ID type: a marker
 *    ("→") or a rule character is a legitimate literal. The shape reports the
 *    position anyway, so a prose literal passed as `value` is visible, and
 *    each decorative literal carries an allowlist reason instead. Issue #53
 *    owns this shape.
 * 11. `notify-helper-argument`: the second argument of a call whose callee is
 *    the bare identifier `notify`, when that argument is a string or template
 *    literal whose static text passes the prose test. A local notification
 *    helper such as `const notify = (ctx, message, type) => …` has no
 *    receiver, so the fifth shape (`notify-argument`, which keys on a receiver
 *    whose text ends in `ui`) cannot see its message. The first argument is the
 *    context, a protected value, so it is not inspected. A same-named method on
 *    a receiver (`row.notify(...)`) is not this shape, because its callee is a
 *    property access, not a bare identifier. Issue #53 owns this shape.
 * 12. `fallback-branch`: the right operand of a `??` or `||` binary expression.
 *    A literal chosen as a nullish or logical fallback is direct text, but it
 *    is a `BinaryExpression` operand rather than a `?:` branch, so the
 *    `conditional-branch` shape could not see it. Issue #57 owns this shape.
 * 13. `assignment-literal`: the right-hand side of an assignment to an
 *    identifier, `catalogWarning = \`…\``. The `variable-literal` shape sees
 *    only a declaration initializer, so a later assignment to an already-declared
 *    name escaped the detector. Issue #57 owns this shape.
 *
 * The first four shapes keep their original non-whitespace content test. The
 * last nine fire only on a literal whose static text passes the prose test,
 * except `apply-argument`, which keeps the non-whitespace test so a decorative
 * literal is reported too.
 *
 * ## The prose test
 *
 * The nine new shapes apply the conservative `SKIP_VALUE_RE` filter below.
 * A literal's static text (interpolations removed) is prose when:
 *
 * - it is at least three characters;
 * - it contains at least one ASCII letter;
 * - it contains a space, or it matches a single capitalized word, an uppercase
 *   letter followed by lowercase letters with an optional trailing colon or
 *   period; and
 * - it does not match `SKIP_VALUE_RE`, which rejects a dotted identifier
 *   (`catalog.warning`), a kebab-case identifier (`model-id`), a
 *   SCREAMING_CASE constant (`CATALOG_WARNING`), a URL, anything containing a
 *   slash, a filename with a known extension, and a bare number.
 *
 * `packages/cli/test/direct-strings.test.mjs` covers these boundaries, including
 * values with a trailing newline.
 *
 * ## The non-UI property set
 *
 * The `record-value` shape skips property names whose value is not human-facing
 * UI text: `description`, `instructions`, `systemPrompt`, `prompt`,
 * `promptSnippet`, `content`, `role`, `id`, `key`, `type`, `kind`, `mode`,
 * `command`, `name`, `model`, `provider`, `path`, `url`, `format`, `source`,
 * `version`, `protocol`, `schema`, and `signature`. These are model-facing,
 * machine-readable, or protected values, so a literal there is not a string the
 * migration should move onto the catalog.
 *
 * ## Which kind a literal gets
 *
 * A literal is reported exactly once. When more than one shape sees it, the
 * earliest kind in this order wins:
 *
 * `console-literal`, `report-entry`, `warning-message` and `problem-message`,
 * the six label properties, `notify-argument`, `notify-helper-argument`,
 * `error-argument`, `apply-argument`, `conditional-branch`, `variable-literal`,
 * `record-value`, `fallback-branch`, `assignment-literal`. The two shapes from
 * issue #57 come last, so a literal an earlier shape already saw keeps its
 * kind and every existing allowlist entry stays valid.
 *
 * The four original kinds come first, so a literal that already matched an
 * existing shape keeps its existing kind and the current allowlist entries
 * stay valid.
 *
 * It deliberately does not match:
 *
 * - `console.log(value)` and `console.error(value)` with a non-literal value.
 * - `warning(id, message)` or `problem(id, message)` where `message` is a
 *   catalog call (`catalogText(...)`), a variable or member expression
 *   (`packageState.warning`), or a `+` concatenation of protected values: none
 *   is a literal the detector can resolve statically. A migrated diagnosis
 *   passes a catalog ID plus an argument object, so the message is a call or a
 *   variable and the shape no longer matches.
 * - A `label` or `title` property whose value is a call, an identifier, or a
 *   member expression: the call carries a catalog ID, and the other two are
 *   dynamic values the detector cannot resolve statically. A migrated label
 *   table holds catalog IDs, so the shape stops matching.
 * - A new shape whose literal fails the prose test: a catalog ID, a kebab-case
 *   token, a path, a URL, a filename, a bare number, or a literal shorter than
 *   three characters. Those are protected values, not prose.
 * - `throw new Error("...")` and every other string that is not one of the
 *   thirteen shapes above. Those surfaces have their own migration issues, and
 *   widening this detector without an owner would make it report work no issue
 *   tracks.
 * - The `--json` output. It is `JSON.stringify(...)`, a call, not a literal.
 * - A blank or whitespace-only literal: it has no non-whitespace character.
 * - A template with no static words, such as `` `${path}` ``.
 *
 * A literal that is only a separator (for example `"·"`) or only a protected
 * value (for example `` `${code}: ${message}` ``) is still reported by the
 * original shapes: it is a direct string, and the allowlist records why it is
 * safe rather than the detector guessing. That keeps the exception reviewable.
 *
 * ## Shapes the detector cannot see
 *
 * The thirteen shapes are syntactic: they fire only when a literal sits at one of
 * the inspected positions. These human-facing shapes are invisible here, so a
 * type guard is the mitigation, not another detector rule:
 *
 * - A literal returned from a function and later passed to an API that accepts
 *   a plain `string`. The install-channel words were returned by
 *   `describeInstallChannel` and rendered as a doctor field; the portability
 *   sentences were built by `getPortabilityWarnings` and rendered as report
 *   entries. Neither was a literal at a detected position.
 * - A literal passed to an API that takes a plain `string` and is not one of
 *   the thirteen shapes: `report(...)`, `notes.push(...)`, `field(...)`, or
 *   `console.error(bootstrap.message)`.
 * - A literal argument to `lines.push(...)`. The flow-status report was built
 *   this way before this shape was introduced. A `push-argument` shape gated on the prose test can
 *   reach a prose literal without reporting the blank and separator pushes, but
 *   `.push` is a generic array sink used across the CLI, so the same shape would
 *   also report model-facing prose (`model-guidance.ts`) and user-facing English
 *   owned by other issues (`textguard-review.ts`, `runtime-diagnostics.ts`,
 *   `session-activity.ts`, and the recovery sentences in
 *   `flow-status-extension.ts`). Those findings would need allowlist entries
 *   that record another surface's debt, and the shape still could not see the
 *   `heading(<literal>)` call or the `return <literal>` position in the same
 *   file, so it would overstate its coverage. No type guard replaces a
 *   `string[]` sink, so the mitigation is the migration itself: every report
 *   line now comes from `catalogText(catalog, …)` or a protected value, and the
 *   locale-wiring test fails if a line stops resolving from the bundle. No
 *   `push-argument` shape is added for this position.
 * - The fallback renderer in `flow-status.ts` below `formatFlowStatus`'s
 *   `if (status.context)` branch. Both production callers pass a captured
 *   context: `flow-status-extension.ts` for `/flow`, and `flow-runtime.ts`
 *   builds the dashboard status with `captureFlowStatusContext`. The branch is
 *   reached only by direct unit tests, which assert its original English text,
 *   so it stays English and no shape is added for it.
 * - A literal's static words inside a template that is handed to a non-console
 *   API, where only the interpolation would be visible.
 * - A literal inside a helper's returned template that a caller later passes to
 *   a notification API. The TextGuard review's `alertText` helper builds
 *   `TextGuard flagged …` and `TextGuard withheld …` and returns them to
 *   `notify` as a call result, so the literal is not at any position a shape
 *   keys on. `formatReleaseExtensionFailure` is the same position: it returns
 *   the `Optional extension …` sentence that the caller passes to
 *   `ui.notify(message, "warning")` or `console.error(…)`. Such a helper's prose
 *   moves onto the catalog even though no shape reports it.
 * - A plain `new Error(<literal>)`. The `error-argument` shape inspects only
 *   `UsageError` and `CatalogError`; a generic `Error` whose `message` a `catch`
 *   passes to `ctx.ui.notify(…, "error")` reaches the user, so user-facing
 *   error text goes through `UsageError` or `CatalogError`, or through the
 *   catalog. The shape is deliberately not widened to every `new Error`, because
 *   most of the several hundred `new Error(` sites in `packages/cli/src` are
 *   internal invariants the user never reads. The Models picker's failure
 *   callbacks are this position: `onSelect`, `onCompactAndSelect`, `onRefresh`,
 *   and `onRefreshCatalogs` throw `new Error(<catalog lookup>)` from inside an
 *   argument callback, and `ModelPickerComponent` renders the message verbatim
 *   in its message area or as the `{ $detail }` of a refresh failure. No shape
 *   keys on a callback argument, and widening `error-argument` to every generic
 *   `new Error` would report the internal invariants above, so the picker stays
 *   undetectable here. The catalog lookup is the mitigation, and the picker's
 *   locale-wiring test fails if a callback stops reading the resolved bundle.
 *
 * Those APIs now take a catalog-ID type (`CatalogMessageRef`) instead of a
 * `string`, so a literal sentence does not type-check. The doctor field values
 * and the notes carry the same catalog ID beside the English report value,
 * because `--json` must stay English while the human renderer localizes. A
 * reviewer must therefore check the type signature, not only this script, when
 * one of those surfaces changes.
 *
 * ## The allowlist
 *
 * `scripts/direct-strings-allowlist.json` holds one entry per allowed
 * candidate, keyed by file, kind, and the literal's text with an interpolation
 * placeholder (`{…}`). Every entry must carry a non-empty `reason` and a
 * `category`. The script refuses to run when an entry has no reason, when an
 * entry matches nothing (so a stale entry cannot linger), or when a candidate
 * is not listed at all. Because the key includes the literal text, a changed
 * or new string does not inherit an old exception; a reviewer sees the new
 * text and its diff.
 *
 * A reviewer should check that:
 *
 * The `category` records why the literal may stay English, not who owns it:
 *
 * - `protected-values`: it prints only a protected value (a path, a digest, an
 *   ID, a key) and no sentence.
 * - `json-output`: it is a `--json` branch, not human text.
 * - `blank-or-separator`: it has no words.
 * - `pending-migration`: it is debt. The reason must link to a public issue
 *   that tracks moving the string into a catalog. Completed migrations remove
 *   their entries.
 * - `product-name`: it is a name kept English as a product noun. The reason
 *   must name the decision and its date.
 * - `upstream-mirror`: it mirrors a Pi or extension value. The reason must name
 *   the upstream owner.
 * - `model-facing`: the model reads it, not the user: a system prompt, a tool
 *   description, or tool result text that is returned to the model. The reason
 *   must say which of those it is. It stays English on purpose, because
 *   translating it would change what the model is told, and the localization
 *   records the same boundary as `messageKind: model`.
 *
 * Ownership is not recorded here: a string that Pi or an extension renders
 * never reaches this file, because the detector only scans Jouzu source. The
 * user-facing classification of the residual upstream English is a separate
 * artifact.
 *
 * A reviewer should check that:
 *
 * - Each `protected-values` entry really prints only a protected value (a
 *   path, a digest, an ID, a key) and no sentence.
 * - Each `json-output` entry is a `--json` branch, not human text.
 * - Each `blank-or-separator` entry has no words.
 * - Each `pending-migration` entry links to the public issue tracking the
 *   string, and the string is genuinely a finding and not a legitimate
 *   exception mislabeled to pass the check.
 * - Each `product-name` entry names the decision that kept it English, so a
 *   later reviewer can reopen the decision instead of guessing.
 * - Each `upstream-mirror` entry names the upstream owner, so the boundary is
 *   visible where the string is copied.
 *
 * The reason text is not decorative: it is the reviewer's record of why the
 * exception is safe, and a blanket entry such as "known" or "temporary" is not
 * an acceptable reason.
 */

import { globSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const scriptDir = fileURLToPath(new URL(".", import.meta.url));
const defaultRoot = resolve(scriptDir, "..");

/** The legitimate exception kinds. Each category carries its own reason rule. */
const CATEGORIES = new Set([
	"protected-values",
	"json-output",
	"blank-or-separator",
	"model-facing",
	"pending-migration",
	"product-name",
	"upstream-mirror",
]);

/** The doctor diagnostic helpers whose message argument the third shape inspects. */
const DIAGNOSTIC_MESSAGE_HELPERS = new Set(["warning", "problem"]);

/**
 * The local notification helpers whose message argument the eleventh shape
 * inspects. A helper with a receiver, `ctx.ui.notify(message, type)`, is the
 * fifth shape's position instead.
 */
const NOTIFY_HELPER_NAMES = new Set(["notify"]);

/** The object-literal properties whose literal value is a human-facing label. */
const LABEL_PROPERTIES = new Set(["label", "title", "hint", "text", "placeholder", "summary"]);

/**
 * The object-literal properties whose value is not human-facing UI text, so the
 * `record-value` shape does not inspect them. `description` is here rather than
 * in `LABEL_PROPERTIES` for the same reason the fourth shape leaves it out: in
 * this codebase it is mostly the tool description the model reads.
 */
const NON_UI_PROPERTIES = new Set([
	"description",
	"instructions",
	"systemPrompt",
	"prompt",
	"promptSnippet",
	"content",
	"role",
	"id",
	"key",
	"type",
	"kind",
	"mode",
	"command",
	"name",
	"model",
	"provider",
	"path",
	"url",
	"format",
	"source",
	"version",
	"protocol",
	"schema",
	"signature",
]);

/** The error classes whose first constructor argument the `error-argument` shape inspects. */
const ERROR_CLASSES = new Set(["UsageError", "CatalogError"]);

/**
 * The candidate kinds, most specific first. When more than one shape sees the
 * same literal, the earliest kind here wins, so a literal is reported exactly
 * once. The four original kinds come first, which keeps every existing
 * allowlist entry (keyed by file, kind, and text) valid.
 */
const KIND_PRECEDENCE = new Map(
	[
		"console-literal",
		"report-entry",
		"warning-message",
		"problem-message",
		"label-property",
		"title-property",
		"hint-property",
		"text-property",
		"placeholder-property",
		"summary-property",
		"notify-argument",
		"notify-helper-argument",
		"error-argument",
		"apply-argument",
		"conditional-branch",
		"variable-literal",
		"record-value",
		"fallback-branch",
		"assignment-literal",
	].map((kind, rank) => [kind, rank]),
);

/**
 * The value filter the new shapes apply: a value is prose when
 * it is at least three characters, carries an ASCII letter, carries a space (or
 * is a single capitalized word, optionally with a trailing colon or period),
 * and is not a protected value such as a dotted or kebab-case identifier, a
 * SCREAMING_CASE constant, a URL, a path, a filename, or a bare number. The
 * pattern below excludes those values before checking for human text.
 */
const SKIP_VALUE_RE =
	/^(?:[a-z0-9_]+(?:[.:][a-z0-9_]+)+|[a-z0-9_]+(?:-[a-z0-9_]+)+|[A-Z][A-Z0-9_]+|https?:\/\/\S*|\S*\/\S*|[a-z0-9_.-]+\.(?:js|mjs|cjs|ts|json|md|lock|txt|yaml|yml)|\d+(?:\.\d+)*)$/u;

/**
 * Treat a trailing newline as whitespace rather than changing the classification
 * of an otherwise protected identifier.
 */
function anchoredMatch(pattern, value) {
	return pattern.test(value) || (value.endsWith("\n") && pattern.test(value.slice(0, -1)));
}

/** The prose test the new shapes apply, ported from `is_prose`. */
function isProse(value) {
	if ([...value].length < 3) return false;
	if (!/[A-Za-z]/u.test(value)) return false;
	if (!/[ \u3000]/u.test(value) && !anchoredMatch(/^[A-Z][a-z]+[:.]?$/u, value)) return false;
	if (anchoredMatch(SKIP_VALUE_RE, value)) return false;
	return true;
}

/** A reason shorter than this is treated as boilerplate, not a record. */
const MINIMUM_REASON_LENGTH = 20;

/** The default scan: every Jouzu CLI and Session UI source file, tests excluded. */
function defaultFiles(root) {
	return [
		...globSync("packages/cli/src/**/*.ts", { cwd: root }),
		...globSync("packages/session-ui/src/**/*.ts", { cwd: root }),
	]
		.filter((path) => !path.endsWith(".test.ts") && !path.endsWith(".d.ts"))
		.map((path) => resolve(root, path))
		.sort();
}

function parseArguments(argv) {
	const options = { root: defaultRoot, allowlist: undefined, files: [], showAll: false };
	for (let index = 0; index < argv.length; index += 1) {
		const argument = argv[index];
		if (argument === "--root") options.root = resolve(argv[++index] ?? "");
		else if (argument === "--allowlist") options.allowlist = resolve(argv[++index] ?? "");
		else if (argument === "--all") options.showAll = true;
		else if (argument.startsWith("--")) throw new Error(`unknown option: ${argument}`);
		else options.files.push(resolve(options.root, argument));
	}
	options.allowlist ??= resolve(options.root, "scripts", "direct-strings-allowlist.json");
	return options;
}

/** The literal parts of a literal node, with interpolation removed, for the content test. */
function literalText(node) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (ts.isTemplateExpression(node)) {
		let text = node.head.text;
		for (const span of node.templateSpans) text += span.literal.text;
		return text;
	}
	return undefined;
}

/** The same text with a placeholder where a template interpolates, for the allowlist key. */
function displayText(node) {
	if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
	if (ts.isTemplateExpression(node)) {
		let text = node.head.text;
		for (const span of node.templateSpans) text += `{…}${span.literal.text}`;
		return text;
	}
	return undefined;
}

/** A literal is reported when its static text carries a non-whitespace character. */
function hasNonWhitespace(text) {
	return /\S/u.test(text);
}

function propertyName(name) {
	if (ts.isIdentifier(name)) return name.text;
	if (ts.isStringLiteral(name)) return name.text;
	return undefined;
}

/** The `message` initializer of an object literal that has `status`, `key`, and `message`. */
function commandReportMessage(node) {
	const names = new Set();
	let message;
	for (const property of node.properties) {
		if (!ts.isPropertyAssignment(property) && !ts.isShorthandPropertyAssignment(property)) continue;
		const name = propertyName(property.name);
		if (name === undefined) continue;
		names.add(name);
		if (name === "message" && ts.isPropertyAssignment(property)) message = property.initializer;
	}
	if (!names.has("status") || !names.has("key") || !names.has("message")) return undefined;
	return message;
}

function lineOf(source, node) {
	return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Every candidate in one source file, in source order, with one kind per literal. */
function findCandidates(root, path) {
	const source = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true);
	const file = relative(root, path).split("\\").join("/");
	/** Literal start position -> the candidate that won the precedence rule. */
	const byPosition = new Map();
	/**
	 * Record one shape match. The four original shapes use the non-whitespace
	 * content test; the widened shapes use `isProse`, except `apply-argument`,
	 * which keeps the non-whitespace test so a decorative literal is reported
	 * too. When several shapes see the same literal, the highest-precedence kind
	 * wins, so a literal is reported exactly once.
	 */
	const add = (kind, literal, proseOnly) => {
		if (literal === undefined) return;
		const text = literalText(literal);
		if (text === undefined) return;
		if (proseOnly ? !isProse(text) : !hasNonWhitespace(text)) return;
		const position = literal.getStart(source);
		const existing = byPosition.get(position);
		if (existing !== undefined && KIND_PRECEDENCE.get(existing.kind) <= KIND_PRECEDENCE.get(kind)) return;
		byPosition.set(position, {
			file,
			kind,
			line: lineOf(source, literal),
			text: displayText(literal),
			position,
		});
	};
	const visit = (node) => {
		if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
			const receiver = node.expression.expression;
			const method = node.expression.name.text;
			if (ts.isIdentifier(receiver) && receiver.text === "console" && (method === "log" || method === "error")) {
				for (const argument of node.arguments) add("console-literal", argument, false);
			}
			if (method === "notify" && receiver.getText(source).endsWith("ui")) {
				add("notify-argument", node.arguments[0], true);
			}
			if (method === "apply") {
				add("apply-argument", node.arguments[1], false);
			}
		}
		if (ts.isNewExpression(node) && ts.isIdentifier(node.expression) && ERROR_CLASSES.has(node.expression.text)) {
			add("error-argument", node.arguments?.[0], true);
		}
		if (ts.isConditionalExpression(node)) {
			add("conditional-branch", node.whenTrue, true);
			add("conditional-branch", node.whenFalse, true);
		}
		if (
			ts.isBinaryExpression(node) &&
			(node.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
				node.operatorToken.kind === ts.SyntaxKind.BarBarToken)
		) {
			add("fallback-branch", node.right, true);
		}
		if (ts.isVariableDeclaration(node)) {
			add("variable-literal", node.initializer, true);
		}
		if (
			ts.isBinaryExpression(node) &&
			node.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
			ts.isIdentifier(node.left)
		) {
			add("assignment-literal", node.right, true);
		}
		if (ts.isObjectLiteralExpression(node)) {
			const message = commandReportMessage(node);
			if (message !== undefined) add("report-entry", message, false);
		}
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			DIAGNOSTIC_MESSAGE_HELPERS.has(node.expression.text)
		) {
			add(`${node.expression.text}-message`, node.arguments[1], false);
		}
		if (
			ts.isCallExpression(node) &&
			ts.isIdentifier(node.expression) &&
			NOTIFY_HELPER_NAMES.has(node.expression.text)
		) {
			add("notify-helper-argument", node.arguments[1], true);
		}
		if (ts.isPropertyAssignment(node)) {
			const name = propertyName(node.name);
			if (name !== undefined && LABEL_PROPERTIES.has(name)) {
				add(`${name}-property`, node.initializer, false);
			} else if (name !== undefined && !NON_UI_PROPERTIES.has(name)) {
				add("record-value", node.initializer, true);
			}
		}
		ts.forEachChild(node, visit);
	};
	visit(source);
	return [...byPosition.values()]
		.sort((left, right) => left.position - right.position)
		.map(({ position: _position, ...candidate }) => candidate);
}

function candidateKey(candidate) {
	return `${candidate.file}\u0000${candidate.kind}\u0000${candidate.text}`;
}

/** Load and validate the allowlist; every entry needs a real reason and a known category. */
function readAllowlist(path) {
	let parsed;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new Error(`cannot read the allowlist ${path}: ${error.message}`);
	}
	if (!Array.isArray(parsed)) throw new Error(`${path}: allowlist must be an array`);
	const entries = [];
	for (const [index, entry] of parsed.entries()) {
		const where = `${path}[${index}]`;
		if (entry === null || typeof entry !== "object" || Array.isArray(entry))
			throw new Error(`${where}: entry must be an object`);
		for (const field of ["file", "kind", "text", "category", "reason"]) {
			if (typeof entry[field] !== "string" || entry[field] === "") throw new Error(`${where}: "${field}" is required`);
		}
		if (!CATEGORIES.has(entry.category)) throw new Error(`${where}: unknown category "${entry.category}"`);
		if (entry.reason.trim().length < MINIMUM_REASON_LENGTH)
			throw new Error(
				`${where}: reason is too short to record a decision (${MINIMUM_REASON_LENGTH} characters minimum)`,
			);
		if (
			entry.category === "pending-migration" &&
			!/https:\/\/github\.com\/[^\s/]+\/[^\s/]+\/issues\/\d+\b/u.test(entry.reason)
		)
			throw new Error(`${where}: a pending-migration reason must link to a public issue`);
		if (entry.category === "product-name" && !/\d{4}-\d{2}-\d{2}/u.test(entry.reason))
			throw new Error(`${where}: a product-name reason must name the decision date (YYYY-MM-DD)`);
		if (entry.category === "upstream-mirror" && !/(?:\bpi\b|@[\w.-]+\/[\w.-]+)/iu.test(entry.reason))
			throw new Error(`${where}: an upstream-mirror reason must name the upstream owner (Pi or a package name)`);
		if (
			entry.category === "model-facing" &&
			!/\b(?:system prompt|tool description|tool result|model)\b/iu.test(entry.reason)
		)
			throw new Error(
				`${where}: a model-facing reason must name what reads the text (a system prompt, a tool description, or tool result text)`,
			);
		entries.push(entry);
	}
	return entries;
}

function main() {
	const options = parseArguments(process.argv.slice(2));
	const files = options.files.length > 0 ? options.files : defaultFiles(options.root);
	const allowlist = readAllowlist(options.allowlist);
	const byKey = new Map(allowlist.map((entry) => [`${entry.file}\u0000${entry.kind}\u0000${entry.text}`, entry]));

	const candidates = files.flatMap((path) => findCandidates(options.root, path));
	const usedKeys = new Set();
	const findings = [];
	for (const candidate of candidates) {
		const key = candidateKey(candidate);
		const entry = byKey.get(key);
		if (entry !== undefined) {
			usedKeys.add(key);
			if (options.showAll) {
				console.log(
					`allowlisted  ${candidate.file}:${candidate.line}  [${candidate.kind}] ${JSON.stringify(candidate.text)}  — ${entry.category}: ${entry.reason}`,
				);
			}
			continue;
		}
		findings.push(candidate);
		console.log(
			`direct string  ${candidate.file}:${candidate.line}  [${candidate.kind}] ${JSON.stringify(candidate.text)}`,
		);
	}

	const stale = allowlist.filter((entry) => !usedKeys.has(`${entry.file}\u0000${entry.kind}\u0000${entry.text}`));
	for (const entry of stale) {
		console.error(
			`stale allowlist entry  ${entry.file}  [${entry.kind}] ${JSON.stringify(entry.text)} — the literal no longer exists; remove the entry`,
		);
	}

	if (findings.length > 0) {
		console.error(`direct-string check: ${findings.length} new direct string(s) without an allowlist reason`);
	}
	if (stale.length > 0) {
		console.error(`direct-string check: ${stale.length} stale allowlist entry/entries`);
	}
	if (findings.length === 0 && stale.length === 0) {
		console.log(
			`direct-string check: ${candidates.length} direct string(s), all allowlisted (${allowlist.length} entries with a reason)`,
		);
		return;
	}
	process.exitCode = 1;
}

main();
