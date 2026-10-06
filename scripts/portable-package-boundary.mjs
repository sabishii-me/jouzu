import { readFileSync } from "node:fs";
import { join } from "node:path";

/** A portable npm bundle must not freeze a build host's platform-selected packages.
 * Native assets deliberately shipped for every platform inside a portable package
 * are different: their parent package has no os/cpu/libc restriction.
 */
export function assertPortableBundledPackages(packageDirectory, packedFiles) {
	for (const file of packedFiles) {
		if (!file.path.startsWith("node_modules/") || !file.path.endsWith("/package.json")) continue;
		const metadata = JSON.parse(readFileSync(join(packageDirectory, file.path), "utf8"));
		const restrictions = ["os", "cpu", "libc"].filter((key) => {
			const values = metadata[key];
			return Array.isArray(values) && values.some((value) => value !== "any");
		});
		if (restrictions.length) {
			throw new Error(
				`Portable Jouzu tarball bundles platform-selected package ${metadata.name ?? file.path} (${restrictions.join(", ")}). Keep its dependency resolution outside the bundled tree; do not simply delete the native binary.`,
			);
		}
	}
}
