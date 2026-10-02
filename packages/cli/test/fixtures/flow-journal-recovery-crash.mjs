import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { basename, dirname } from "node:path";

const [root, journal, marker, phase] = process.argv.slice(2);
const originalOpen = fs.openSync;
const originalRename = fs.renameSync;
const originalTruncate = fs.promises.truncate;

function die(repair) {
	fs.writeFileSync(marker, JSON.stringify({ repair, phase }), { mode: 0o600 });
	process.kill(process.pid, "SIGKILL");
}

// Observe the original atomic-replacement boundary as well as in-place repair, so this
// fixture demonstrates the orphan temporary file on the implementation before the fix.
fs.openSync = function (path, ...args) {
	const descriptor = originalOpen.call(this, path, ...args);
	if (phase === "before" && dirname(String(path)) === dirname(journal) && /^\..+\.tmp$/.test(basename(String(path)))) {
		die("atomic-replacement");
	}
	return descriptor;
};
fs.renameSync = function (source, destination) {
	const result = originalRename.call(this, source, destination);
	if (phase === "after" && String(destination) === journal) die("atomic-replacement");
	return result;
};
fs.promises.truncate = async function (path, length) {
	if (String(path) === journal && phase === "before") die("truncate");
	await originalTruncate.call(this, path, length);
	if (String(path) === journal && phase === "after") die("truncate");
};
syncBuiltinESMExports();

const { PiFlowAttachment } = await import("../../dist/flow-control/pi-attachment.js");
const attachment = await PiFlowAttachment.open(root, { sessionId: "parent", branchId: "branch" });
await attachment.close();
throw new Error("Journal recovery did not reach the selected crash boundary");
