import type { ModelCatalogDocument } from "./model-catalog.js";
import type { ModelReference } from "./model-picker-state.js";
import { modelReferenceKey } from "./model-picker-state.js";

/** Catalog defaults are first-use hints, never replacements for saved user choices. */
export function catalogDefaultCandidates(catalogs: readonly { document: ModelCatalogDocument }[]): ModelReference[] {
	const candidates: { reference: ModelReference; priority: number }[] = [];
	for (const { document } of catalogs) {
		for (const offering of document.modelOfferings) {
			const metadata = offering.metadata;
			if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) continue;
			const priority = (metadata as Record<string, unknown>).default;
			if (typeof priority !== "number" || !Number.isSafeInteger(priority)) continue;
			if (offering.availability?.status === "unavailable") continue;
			candidates.push({
				priority,
				reference: {
					catalogId: document.catalogId,
					offeringId: offering.id,
					provider: offering.providerId,
					modelId: offering.modelId,
				},
			});
		}
	}
	candidates.sort((left, right) => {
		if (left.priority !== right.priority) return left.priority > right.priority ? -1 : 1;
		const a = modelReferenceKey(left.reference);
		const b = modelReferenceKey(right.reference);
		return a < b ? -1 : a > b ? 1 : 0;
	});
	const seen = new Set<string>();
	return candidates.flatMap(({ reference }) => {
		const key = modelReferenceKey(reference);
		if (seen.has(key)) return [];
		seen.add(key);
		return [reference];
	});
}
