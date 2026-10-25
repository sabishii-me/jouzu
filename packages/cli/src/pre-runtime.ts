/**
 * The pre-runtime context built once at the top of the CLI entry points.
 *
 * It carries the resolved display context (width, color, locale), the resolved
 * locale catalog, and whether stdout is machine readable. Every pre-launch
 * renderer reads these fields instead of re-resolving the locale, so the
 * decision is made in one place and the same catalog reaches `--help`,
 * `--version`, the argument errors, and the four report commands.
 */

import { type DisplayContext, resolveDisplayContext } from "./command-report.js";
import { type CatalogResolution, resolveCatalog } from "./locale-catalog.js";
import type { ResolvedUiLocale } from "./ui-locale.js";

export interface PreRuntimeContext {
	readonly display: DisplayContext;
	readonly catalog: CatalogResolution;
	readonly machineReadable: boolean;
}

export interface PreRuntimeContextInput {
	/** The UI locale resolved from the option, environment, saved setting, and OS. */
	readonly uiLocale: ResolvedUiLocale;
	/** True when Pi writes a protocol or event stream to stdout. */
	readonly machineReadable: boolean;
}

/**
 * Resolve the display context and the catalog for one launch.
 *
 * The catalog is resolved from the same effective locale the display context
 * carries, so a renderer never has to reconcile two locale decisions. The
 * resolution never throws for a missing or damaged catalog; the English
 * fallback is part of `CatalogResolution`.
 */
export function buildPreRuntimeContext(input: PreRuntimeContextInput): PreRuntimeContext {
	return {
		display: resolveDisplayContext({ locale: input.uiLocale.effective }),
		catalog: resolveCatalog(input.uiLocale.effective),
		machineReadable: input.machineReadable,
	};
}
