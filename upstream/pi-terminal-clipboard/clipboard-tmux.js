import { spawn } from "node:child_process";

export const TMUX_OPT_OUT_ENV = "PI_CLIPBOARD_TMUX";
export const TMUX_COMMAND_TIMEOUT_MS = 1500;
export const TMUX_MAX_TIMEOUT_MS = 5000;
export const TMUX_MAX_BUFFER_BYTES = 1_000_000;
export const TMUX_MAX_OUTPUT_BYTES = 64 * 1024;
export const MAX_OSC52_ENCODED_LENGTH = 100_000;

function timeoutFor(value) {
	if (Number.isFinite(value) && value > 0) return Math.min(value, TMUX_MAX_TIMEOUT_MS);
	return TMUX_COMMAND_TIMEOUT_MS;
}

/** An explicit zero/false/off opt-out keeps Pi's ordinary clipboard behavior. */
export function isTmuxClipboardEnabled(env = process.env) {
	if (!env.TMUX || !env.TMUX_PANE) return false;
	const value = env[TMUX_OPT_OUT_ENV]?.trim().toLowerCase();
	return value !== "0" && value !== "false" && value !== "off";
}

/**
 * TMUX is "socket,server-pid,session-id". Read the session id from the end because the
 * socket path itself may contain a comma.
 */
export function tmuxSessionTarget(tmux) {
	if (typeof tmux !== "string") return undefined;
	const fields = tmux.trim().split(",");
	if (fields.length < 3) return undefined;
	const pid = fields[fields.length - 2];
	const session = fields[fields.length - 1];
	if (!/^\d+$/.test(pid) || !/^\d+$/.test(session)) return undefined;
	return `$${session}`;
}

/**
 * Resolve the pane's current session. The TMUX session id is only used when the pane is
 * still a member of that session; linked windows and moved panes otherwise fall back to the
 * session tmux reports for TMUX_PANE.
 */
export async function resolveTmuxSession(env, run, timeoutMs) {
	const pane = env.TMUX_PANE;
	if (typeof pane !== "string" || !/^%\d+$/.test(pane)) {
		return { ok: false, status: "invalid-context", stage: "resolve" };
	}
	const resolved = await run(["display-message", "-p", "-t", pane, "#{pane_id}|#{session_id}"], {
		timeoutMs,
	});
	if (!resolved.ok) {
		const status =
			resolved.reason === "timeout"
				? "resolve-timed-out"
				: resolved.reason === "unavailable"
					? "unavailable"
					: "resolve-failed";
		return { ok: false, status, stage: "resolve" };
	}
	const match = /^(%\d+)\|(\$\d+)$/.exec(String(resolved.stdout ?? "").trim());
	if (!match || match[1] !== pane) return { ok: false, status: "pane-mismatch", stage: "resolve" };
	const paneSession = match[2];
	const envSession = tmuxSessionTarget(env.TMUX);
	if (!envSession || envSession === paneSession) return { ok: true, pane, session: paneSession };
	const membership = await run(["list-panes", "-s", "-t", envSession, "-F", "#{pane_id}"], { timeoutMs });
	if (membership.ok && String(membership.stdout ?? "").split("\n").map((line) => line.trim()).includes(pane)) {
		return { ok: true, pane, session: envSession };
	}
	return { ok: true, pane, session: paneSession };
}

/**
 * Choose a client attached to the pane's session. A pane has no requesting-client identity
 * when its window is linked or several clients are attached, so use the most recently active
 * client and break ties by terminal path. Clients in other sessions are never considered.
 */
export function selectTmuxClient(output) {
	const clients = [];
	for (const raw of String(output).split("\n")) {
		const line = raw.replace(/\r$/, "");
		const match = /^(\d+)\|(.+)$/.exec(line);
		if (!match) continue;
		const activity = Number(match[1]);
		const tty = match[2];
		if (!Number.isSafeInteger(activity) || !tty || /[\u0000-\u001f\u007f]/.test(tty)) continue;
		clients.push({ activity, tty });
	}
	clients.sort((a, b) => b.activity - a.activity || (a.tty < b.tty ? -1 : a.tty > b.tty ? 1 : 0));
	return clients[0]?.tty;
}

/** OSC 52 wrapped for tmux passthrough; tmux strips the DCS envelope for the outer terminal. */
export function tmuxOsc52Sequence(text) {
	const encoded = Buffer.from(text, "utf8").toString("base64");
	if (encoded.length > MAX_OSC52_ENCODED_LENGTH) return undefined;
	return `\x1bPtmux;\x1b\x1b]52;c;${encoded}\x07\x1b\\`;
}

/**
 * Run one tmux client command with a bounded timeout, bounded output, and no shell. The
 * command may exit before consuming stdin; that EPIPE is expected and must not crash Pi.
 */
export function runTmuxCommand(args, options = {}) {
	return new Promise((resolve) => {
		const timeoutMs = timeoutFor(options.timeoutMs);
		const maxOutputBytes = options.maxOutputBytes ?? TMUX_MAX_OUTPUT_BYTES;
		let child;
		try {
			child = spawn("tmux", args, {
				stdio: ["pipe", "pipe", "ignore"],
				shell: false,
				windowsHide: true,
			});
		} catch (error) {
			resolve({ ok: false, reason: "unavailable", error });
			return;
		}
		const chunks = [];
		let outputBytes = 0;
		let settled = false;
		let inputFailed = false;
		let timer;
		const finish = (result) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve(result);
		};
		const stop = (reason) => {
			try {
				child.kill("SIGKILL");
			} catch {
				// The child may already have exited.
			}
			finish({ ok: false, reason });
		};
		timer = setTimeout(() => stop("timeout"), timeoutMs);
		child.on("error", (error) => {
			finish({ ok: false, reason: error?.code === "ENOENT" ? "unavailable" : "spawn-failed", error });
		});
		child.on("close", (code, signal) => {
			if (settled) return;
			if (code === 0 && inputFailed) finish({ ok: false, reason: "input-failed" });
			else if (code === 0) finish({ ok: true, stdout: Buffer.concat(chunks, outputBytes).toString("utf8") });
			else finish({ ok: false, reason: "exit", code, signal });
		});
		child.stdout?.on("data", (chunk) => {
			if (settled) return;
			outputBytes += chunk.length;
			if (outputBytes > maxOutputBytes) stop("output-too-large");
			else chunks.push(chunk);
		});
		// A tmux client can exit before consuming all input, especially on a failed load-buffer.
		child.stdin?.on("error", () => { inputFailed = true; });
		try {
			child.stdin?.end(options.input);
		} catch {
			// The stream can close between the listener and the write.
			inputFailed = true;
		}
	});
}

/** Emit a wrapped OSC 52 only when tmux passthrough is already enabled; never change options. */
export async function emitTmuxOsc52Fallback(text, options = {}) {
	const run = options.run ?? runTmuxCommand;
	const timeoutMs = timeoutFor(options.timeoutMs);
	const write = options.write ?? ((value) => process.stdout.write(value));
	const pane = options.pane;
	if (typeof pane !== "string" || !/^%\d+$/.test(pane)) return { status: "no-pane" };
	const option = await run(["show-options", "-A", "-pv", "-t", pane, "allow-passthrough"], { timeoutMs });
	if (!option.ok) {
		const status = option.reason === "timeout" ? "passthrough-timed-out" : "passthrough-unavailable";
		return { status };
	}
	const value = String(option.stdout ?? "").trim().replace(/^\*/, "");
	if (value !== "on" && value !== "all") return { status: "passthrough-off" };
	if (value === "on") {
		const visible = await run([
			"display-message", "-p", "-t", pane,
			"#{window_active_clients}|#{window_zoomed_flag}|#{pane_active}",
		], { timeoutMs });
		const match = /^(\d+)\|([01])\|([01])$/.exec(String(visible.stdout ?? "").trim());
		if (!visible.ok || !match || Number(match[1]) === 0 || (match[2] === "1" && match[3] !== "1")) {
			return { status: "pane-not-visible" };
		}
	}
	const sequence = tmuxOsc52Sequence(text);
	if (!sequence) return { status: "oversized" };
	try {
		write(sequence);
	} catch {
		return { status: "write-failed" };
	}
	return { status: "emitted" };
}

/**
 * Load the copied text into tmux and ask an attached client to set its terminal clipboard.
 * `accepted` means tmux accepted the request (or the wrapped fallback was written); it does
 * not confirm that the desktop clipboard changed. A successful load-buffer keeps the new
 * automatic paste buffer, so later paste commands can use it.
 */
export async function copyToTmuxClipboard(text, options = {}) {
	const env = options.env ?? process.env;
	const run = options.run ?? runTmuxCommand;
	const timeoutMs = timeoutFor(options.timeoutMs);
	const write = options.write ?? ((value) => process.stdout.write(value));
	const maxBytes = options.maxBytes ?? TMUX_MAX_BUFFER_BYTES;
	if (!isTmuxClipboardEnabled(env)) return { status: "disabled", accepted: false, confirmed: false };
	if (Buffer.byteLength(text, "utf8") > maxBytes) {
		return { status: "too-large", accepted: false, confirmed: false };
	}
	const resolved = await resolveTmuxSession(env, run, timeoutMs);
	if (!resolved.ok) return { status: resolved.status, stage: resolved.stage, accepted: false, confirmed: false };
	const { pane, session } = resolved;
	const listed = await run(["list-clients", "-t", session, "-F", "#{client_activity}|#{client_tty}"], {
		timeoutMs,
	});
	if (!listed.ok) {
		const status =
			listed.reason === "timeout"
				? "list-timed-out"
				: listed.reason === "unavailable"
					? "unavailable"
					: "list-failed";
		const fallback = await emitTmuxOsc52Fallback(text, { run, timeoutMs, write, pane });
		if (fallback.status === "emitted") {
			return { status: "osc52", stage: "list", accepted: true, confirmed: false, fallback: "emitted" };
		}
		return { status, stage: "list", accepted: false, confirmed: false, fallback: fallback.status };
	}
	const client = selectTmuxClient(listed.stdout);
	if (!client) return { status: "no-client", stage: "list", accepted: false, confirmed: false };
	const loaded = await run(["load-buffer", "-w", "-t", client, "-"], { input: text, timeoutMs });
	if (loaded.ok) return { status: "forwarded", stage: "load", accepted: true, confirmed: false, client };
	const status = loaded.reason === "timeout" ? "load-timed-out" : "load-failed";
	const fallback = await emitTmuxOsc52Fallback(text, { run, timeoutMs, write, pane });
	if (fallback.status === "emitted") {
		return { status: "osc52", stage: "load", accepted: true, confirmed: false, client, fallback: "emitted" };
	}
	return { status, stage: "load", accepted: false, confirmed: false, client, fallback: fallback.status };
}
