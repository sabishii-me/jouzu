import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const canvasVersion = "1.0.11";
const canvasName = "@napi-rs/canvas";

/** Keep the consumer-selected canvas outside the bundled extension tree. */
export function externalizeBundledCanvas(packageRoot) {
	const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
	if (manifest.dependencies?.[canvasName] !== canvasVersion) {
		throw new Error(`jouzu must declare external ${canvasName}@${canvasVersion}`);
	}
	function visit(root, allowLegacyCanvas = false) {
		const modules = join(root, "node_modules");
		if (!existsSync(modules)) return;
		for (const entry of readdirSync(modules, { withFileTypes: true })) {
			if (!entry.isDirectory()) continue;
			const directory = join(modules, entry.name);
			const packages = entry.name.startsWith("@")
				? readdirSync(directory, { withFileTypes: true })
						.filter((child) => child.isDirectory())
						.map((child) => join(directory, child.name))
				: [directory];
			for (const path of packages) {
				const metadata = join(path, "package.json");
				if (!existsSync(metadata)) continue;
				const pkg = JSON.parse(readFileSync(metadata, "utf8"));
				if (pkg.name === canvasName || pkg.name?.startsWith(`${canvasName}-`)) {
					// The CLI's direct installation is needed for development and is not bundled.
					if (root === packageRoot) continue;
					if (pkg.version !== canvasVersion && !(allowLegacyCanvas && pkg.version === "0.1.80")) {
						throw new Error(`Unexpected bundled canvas version: ${pkg.version}`);
					}
					rmSync(path, { recursive: true, force: true });
				} else {
					let changed = false;
					for (const field of ["dependencies", "optionalDependencies"]) {
						const required = pkg[field]?.[canvasName];
						if (required === undefined) continue;
						if (
							required !== canvasVersion &&
							required !== `^${canvasVersion}` &&
							!(
								(pkg.name === "pdf-parse" || (allowLegacyCanvas && pkg.name === "pdfjs-dist")) &&
								(required === "0.1.80" || required === "^0.1.80")
							)
						) {
							throw new Error(`${pkg.name} requires an unexpected canvas version: ${required}`);
						}
						// The CLI owns this dependency; leaving even an optional edge makes
						// npm's bundle traversal include the hoisted platform-selected copy.
						delete pkg[field][canvasName];
						changed = true;
					}
					if (changed) writeFileSync(metadata, `${JSON.stringify(pkg, null, 2)}\n`);
					visit(path, allowLegacyCanvas || pkg.name === "pdf-parse" || pkg.name === "pdfjs-dist");
				}
			}
		}
	}
	visit(packageRoot);
}

export function assertExternalCanvas(files, manifest) {
	if (manifest.dependencies?.[canvasName] !== canvasVersion || manifest.bundleDependencies?.includes(canvasName)) {
		throw new Error(`jouzu must install external ${canvasName}@${canvasVersion}`);
	}
	if (files.some(({ path }) => /(?:^|\/)node_modules\/@napi-rs\/canvas(?:-[^/]+)?\//u.test(path))) {
		throw new Error("jouzu tarball contains bundled canvas or a platform-selected canvas binding");
	}
}
