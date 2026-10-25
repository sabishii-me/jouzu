import type { CatalogBundle } from "./locale-catalog.js";

/** Keep existing views attached to the catalog selected by a confirmed UI change. */
export function createDisplayCatalog(initial: CatalogBundle): {
	bundle: CatalogBundle;
	update: (next: CatalogBundle) => void;
} {
	let current = initial;
	const bundle: CatalogBundle = {
		get locale() {
			return current.locale;
		},
		get version() {
			return current.version;
		},
		get digest() {
			return current.digest;
		},
		get messages() {
			return current.messages;
		},
		format: (id, args) => current.format(id, args),
		render: (id, args, options) => current.render(id, args, options),
	};
	return {
		bundle,
		update: (next) => {
			current = next;
		},
	};
}
