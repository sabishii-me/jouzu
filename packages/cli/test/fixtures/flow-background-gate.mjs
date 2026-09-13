import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterFlowCleanup } from "./flow-assembly.mjs";

export async function controlledBackground(t) {
	const root = await mkdtemp(join(tmpdir(), "jouzu-pair-gate-"));
	afterFlowCleanup(t, () => rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 }));
	const releaseFile = join(root, "release");
	const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
	const script =
		"const fs=require('node:fs');const timer=setInterval(()=>{if(fs.existsSync(process.argv[1])){clearInterval(timer);console.log('finished')}},20)";
	return {
		command: `node -e ${quote(script)} ${quote(releaseFile)}`,
		release: () => writeFile(releaseFile, "ready"),
	};
}
