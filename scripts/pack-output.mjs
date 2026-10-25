/**
 * Read the tarball entry from `npm pack --json` output.
 *
 * npm 11 and earlier print an array of entries. npm 12 prints an object keyed by
 * package name, for a single package as well. Both describe the same tarball, so
 * accept either shape and return the first entry that carries a `filename`.
 *
 * Anything else is rejected with the raw output in the message: a future format
 * change must fail loudly here rather than return `undefined` and fail later
 * with an unrelated error.
 */

const maxReportedOutput = 200;

function reported(stdout) {
	const collapsed = String(stdout).replace(/\s+/gu, " ").trim();
	return collapsed.length > maxReportedOutput ? `${collapsed.slice(0, maxReportedOutput)}…` : collapsed;
}

export function packedTarballEntry(stdout) {
	let parsed;
	try {
		parsed = JSON.parse(stdout);
	} catch (error) {
		throw new Error(`npm pack --json did not print JSON: ${reported(stdout)}`, { cause: error });
	}
	const entries = Array.isArray(parsed)
		? parsed
		: parsed !== null && typeof parsed === "object"
			? Object.values(parsed)
			: [];
	const entry = entries.find(
		(candidate) => candidate !== null && typeof candidate === "object" && typeof candidate.filename === "string",
	);
	if (!entry) {
		throw new Error(`npm pack --json printed no tarball entry: ${reported(stdout)}`);
	}
	return entry;
}
