// Exact-source changes for the bundled pi-code-previews extension. Hashes are checked by apply-code-previews.mjs.
function replace(text, before, after) {
	const parts = text.split(before);
	if (parts.length !== 2) throw new Error(`Code previews path contract mismatch: ${before.slice(0, 100)}`);
	return parts.join(after);
}

const PRISTINE_BLOCK = `  let expanded = path.startsWith("@") ? path.slice(1) : path;
  expanded = expanded.replace(/[\\u00A0\\u2000-\\u200A\\u202F\\u205F\\u3000]/g, " ");
  if (expanded === "~") expanded = homedir();
  else if (expanded.startsWith("~/")) expanded = \`\${homedir()}\${expanded.slice(1)}\`;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);`;

const EXACT_BLOCK = `  let expanded = path.startsWith("@") ? path.slice(1) : path;
  if (expanded === "~") expanded = homedir();
  else if (expanded.startsWith("~/")) expanded = \`\${homedir()}\${expanded.slice(1)}\`;
  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);`;

// The earlier carried revision normalized the path and selected an existing alias. Migration
// removes that tail and the existsSync import without touching any other bytes.
const FALLBACK_TAIL = `  const exact = isAbsolute(expanded) ? expanded : resolve(cwd, expanded);
  const normalized = exact.replace(/[\\u00A0\\u2000-\\u200A\\u202F\\u205F\\u3000]/g, " ");
  if (normalized === exact || existsSync(exact)) return exact;
  return existsSync(normalized) ? normalized : exact;`;

const EXACT_TAIL = `  return isAbsolute(expanded) ? expanded : resolve(cwd, expanded);`;

const PRISTINE_IMPORT = `import { loadCodePreviewSettings } from "../settings/bootstrap";
`;

const THEME_IMPORT = `import { loadCodePreviewSettings } from "../settings/bootstrap";
import { defaultCodePreviewSettings } from "../settings/defaults";
import { isBundledThemeName } from "../settings/definitions";
`;

const PRISTINE_LOAD = `    try {
      await loadCodePreviewSettings(ctx.cwd, projectTrusted);`;

// Pi fires session_start after the terminal reports its colors, so the theme's appearance is
// settled here. Changing the default keeps saved settings and CODE_PREVIEW_THEME authoritative,
// and the settings panel still compares against the same loaded baseline when it saves.
const THEME_LOAD = `    try {
      if (!isBundledThemeName(process.env.CODE_PREVIEW_THEME))
        defaultCodePreviewSettings.shikiTheme =
          ctx.ui?.theme?.appearance === "light" ? "light-plus" : "dark-plus";
      await loadCodePreviewSettings(ctx.cwd, projectTrusted);`;

function transformResolve(source) {
	// The write tool resolves mutation paths exactly: no Unicode-space aliasing and no
	// filesystem-based alias selection. Only @ stripping and ~ expansion remain.
	if (source.includes(EXACT_BLOCK)) return source;
	if (source.includes(FALLBACK_TAIL)) {
		const migrated = replace(source, `import { existsSync } from "node:fs";\n`, "");
		return replace(migrated, FALLBACK_TAIL, EXACT_TAIL);
	}
	return replace(source, PRISTINE_BLOCK, EXACT_BLOCK);
}

function transformExtension(source) {
	// Code previews follow Pi's light or dark theme unless the user chose a Shiki theme.
	if (source.includes(THEME_LOAD)) return source;
	return replace(replace(source, PRISTINE_IMPORT, THEME_IMPORT), PRISTINE_LOAD, THEME_LOAD);
}

export function transform(path, source) {
	if (path === "src/paths/resolve.ts") return transformResolve(source);
	if (path === "src/extension/index.ts") return transformExtension(source);
	throw new Error(`Unknown patch path ${path}`);
}
