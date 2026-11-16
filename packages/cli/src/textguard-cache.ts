import { createHash } from "node:crypto";
import { MAX_SCAN_BYTES, type ScanEvidence, type TextScanner, unavailable } from "./textguard.js";
import { type NativeEvidence, parseNativeEvidence } from "./textguard-native.js";

const MAX_ENTRIES = 128;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
interface IdentifiedScanner extends TextScanner {
	initialize(): Promise<string | undefined>;
}

/**
 * Complete verdicts, kept in this process only. Verdicts are never read from
 * disk: the agent's tools run as the same user and could write any file this
 * process trusts, so a stored verdict could turn flagged content into "clear".
 * Content and user approvals are never retained.
 */
export class CachedTextGuard implements TextScanner {
	private records = new Map<string, string>();
	private initialization?: Promise<void>;
	private scannerIdentity?: string;
	private closed = false;
	constructor(private scanner: IdentifiedScanner) {}
	get identity(): string | undefined {
		return this.scannerIdentity;
	}

	async initialize(): Promise<string | undefined> {
		this.initialization ??= this.scanner.initialize().then(
			(identity) => {
				this.scannerIdentity = identity;
			},
			() => {
				this.scannerIdentity = undefined;
			},
		);
		await this.initialization;
		return this.scannerIdentity;
	}

	private read(input: string, response: string): NativeEvidence | undefined {
		const evidence = parseNativeEvidence(Buffer.from(response), "cache", input);
		if (evidence.status !== "unavailable") return evidence;
	}

	async scan(text: string, timeoutMs = 2000, signal?: AbortSignal): Promise<ScanEvidence> {
		if (this.closed) return unavailable("closed");
		if (/[\uD800-\uDFFF]/u.test(text)) return unavailable("protocol");
		if (Buffer.byteLength(text) > MAX_SCAN_BYTES) return unavailable("input-limit");
		if (signal?.aborted || !Number.isFinite(timeoutMs) || timeoutMs <= 0) return unavailable("timeout");
		const started = performance.now();
		await this.initialize();
		if (this.closed) return unavailable("closed");
		if (signal?.aborted || performance.now() - started >= timeoutMs) return unavailable("timeout");
		const input = digest(text);
		const response = this.records.get(input);
		const cached = response !== undefined && this.read(input, response);
		if (cached) {
			this.records.delete(input);
			this.records.set(input, response);
			return cached;
		}
		const remaining = timeoutMs - (performance.now() - started);
		if (remaining <= 0) return unavailable("timeout");
		const evidence = (await this.scanner.scan(text, remaining, signal)) as NativeEvidence;
		if (this.scannerIdentity && evidence.status !== "unavailable" && !this.closed) {
			const entry = JSON.stringify({
				version: 1,
				id: "cache",
				input_sha256: input,
				status: evidence.status,
				findings: evidence.findings,
				finding_count: evidence.findingCount,
				severity_counts: evidence.severityCounts,
				decode_reasons: evidence.decodeReasons,
			});
			if (this.read(input, entry)) {
				this.records.delete(input);
				this.records.set(input, entry);
				while (this.records.size > MAX_ENTRIES) this.records.delete(this.records.keys().next().value as string);
			}
		}
		return evidence;
	}

	async close(): Promise<void> {
		this.closed = true;
		await this.scanner.close();
		await this.initialization;
		this.records.clear();
	}
}
