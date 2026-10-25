/**
 * Seed the model catalog into an isolated live-run home.
 *
 * The live smokes run the packed artifact with `--jouzu-home <temp>`, so a run
 * cannot read or write the developer's own home. A catalog-backed provider id
 * (`catalog:<catalog-id>:<provider-id>:<digest>`) only exists once the model
 * catalog is present in that home, so `--provider` resolves only after the
 * catalog has been refreshed there. `jz catalog refresh` fetches every
 * configured source, activates the revision, and caches it under
 * `<home>/cache/model-catalog`; the run then reads that cache, including with
 * `PI_OFFLINE=1`.
 *
 * A fresh home has no catalog, and the product does not fetch one by itself:
 * `jz --jouzu-home <empty> --list-models` reports no models, while the same
 * command after this refresh lists the source's models.
 */

/** The argv that refreshes every configured catalog source into `home`. */
export function catalogRefreshArgs({ cli, home }) {
	return [cli, "--jouzu-home", home, "catalog", "refresh", "--json"];
}

/**
 * Refresh the model catalog into `home` with the installed CLI.
 *
 * `env` must carry the provider credential (for example `SHISA_API_KEY`) and
 * must not set `PI_OFFLINE`, because the refresh uses the network. The run that
 * follows may set `PI_OFFLINE=1`, which still reads the cached catalog. `run` is
 * the caller's own helper, so each smoke keeps its timeout and assertions.
 */
export function seedModelCatalog({ cli, home, env, run }) {
	run(process.execPath, catalogRefreshArgs({ cli, home }), { env });
}
