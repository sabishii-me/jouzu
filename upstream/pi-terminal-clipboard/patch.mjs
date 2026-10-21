// Exact-source changes for the pinned Pi package. Hashes are checked by apply-pi-terminal-clipboard.mjs.
import { readFileSync } from "node:fs";
import { join } from "node:path";

function replace(text, before, after, count = 1) {
	const parts = text.split(before);
	if (parts.length !== count + 1)
		throw new Error(`Pi terminal-clipboard contract mismatch: ${before.slice(0, 100)}`);
	return parts.join(after);
}

export const paths = ["dist/utils/clipboard.js"];

/** Installed additions are copied verbatim from the matching file in this directory. */
export const additions = {
	"dist/utils/clipboard-tmux.js": "clipboard-tmux.js",
};

export function additionSource(name) {
	return readFileSync(join(import.meta.dirname, name), "utf8");
}

export function transform(path, source) {
	if (path !== "dist/utils/clipboard.js") throw new Error(`Unknown patch path ${path}`);
	let text = source;
	text = replace(
		text,
		`import { isWSL } from "./wsl.js";
const MAX_OSC52_ENCODED_LENGTH = 100_000;`,
		`import { isWSL } from "./wsl.js";
import { copyToTmuxClipboard, isTmuxClipboardEnabled } from "./clipboard-tmux.js";
const MAX_OSC52_ENCODED_LENGTH = 100_000;`,
	);
	text = replace(
		text,
		`    let copied = false;
    // Direct writes precede OSC 52 so the terminal cannot race the native writer.`,
		`    let copied = false;
    const tmuxEnabled = isTmuxClipboardEnabled(env);
    // Direct writes precede OSC 52 so the terminal cannot race the native writer.`,
	);
	text = replace(
		text,
		`    if (!copied && p === "linux" && isWSL(env)) {
        // Windows Terminal supports OSC 52; prefer it over the slower PowerShell round trip.
        if (env.WT_SESSION)
            osc52Emitted = emitOsc52(text);
        copied = osc52Emitted || (await copyViaWindowsClipboard(text));
    }
    // OSC 52 cannot be verified, so a desktop session with a display reports the failure`,
		`    if (!copied && p === "linux" && isWSL(env)) {
        // Windows Terminal supports OSC 52; prefer it over the slower PowerShell round trip.
        if (env.WT_SESSION && !tmuxEnabled)
            osc52Emitted = emitOsc52(text);
        copied = osc52Emitted || (await copyViaWindowsClipboard(text));
    }
    // tmux can load a paste buffer and ask an attached client to set its terminal clipboard
    // with its default set-clipboard external setting. The command is a forwarding request,
    // not proof that the desktop clipboard changed.
    let tmuxStatus;
    if (tmuxEnabled) {
        const tmux = await copyToTmuxClipboard(text, { env });
        tmuxStatus = tmux.status;
        if (tmux.accepted) {
            copied = true;
            osc52Emitted = true;
        }
    }
    // OSC 52 cannot be verified, so a desktop session with a display reports the failure`,
	);
	text = replace(
		text,
		`    if (!osc52Emitted && (isRemoteSession(env) || (!copied && headless))) {`,
		`    if (!tmuxEnabled && !osc52Emitted && (isRemoteSession(env) || (!copied && headless))) {`,
	);
	text = replace(
		text,
		`    if (copied)
        return;
    if (oversized)`,
		`    if (copied)
        return;
    if (tmuxEnabled)
        throw new Error(\`Clipboard unavailable: tmux forwarding failed (\${tmuxStatus ?? "unavailable"})\`);
    if (oversized)`,
	);
	return text.replace(/^\/\/# sourceMappingURL=.*\n?/m, "");
}
