export interface ControlLanguage {
  readable: boolean;
  state: string;
  uiLocale: { requested: string; effective: string; source: string; fallback?: string };
  responseLanguage: { requested: string; effective: string; source: string };
  saved: { uiLocale: string; responseLanguage: string | null } | null;
  suggestedResponseLanguage: string;
  legacyProfile: string | null;
}
export interface ControlState {
  modelReady?: boolean;
  connectionCheck?: { provider: string; status: string };
  profile: string | null;
  language?: ControlLanguage;
  account: { signedIn: boolean; revocation?: "confirmed" | "unconfirmed" | "not-linked" };
  customProviders: { id: string; url: string; model: string; editable: boolean }[];
  providers: { id: string; name: string }[];
  credentials: { providerId: string }[];
  models: { provider: string; id: string; name: string }[];
  defaultProvider?: string;
  defaultModel?: string;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const uiLocaleValues = ["auto", "en", "ja", "zh-Hans", "zh-Hant"];
const effectiveUiLocaleValues = ["en", "ja", "zh-Hans", "zh-Hant"];
const responseLanguageValues = ["auto", "en", "ja", "zh-Hans", "zh-Hant"];
const sourceValues = ["cli", "env", "session", "config", "os", "builtin"];
function parseLanguage(value: unknown, fail: () => never): ControlLanguage {
  const check = (candidate: unknown) => (typeof candidate === "string" && candidate.length > 0 ? candidate : fail());
  if (!record(value) || typeof value.readable !== "boolean" || !record(value.uiLocale) || !record(value.responseLanguage)) return fail();
  const uiLocale = {
    requested: check(value.uiLocale.requested),
    effective: check(value.uiLocale.effective),
    source: check(value.uiLocale.source),
    ...(value.uiLocale.fallback !== undefined ? { fallback: check(value.uiLocale.fallback) } : {}),
  };
  const responseLanguage = {
    requested: check(value.responseLanguage.requested),
    effective: check(value.responseLanguage.effective),
    source: check(value.responseLanguage.source),
  };
  if (!uiLocaleValues.includes(uiLocale.requested) || !effectiveUiLocaleValues.includes(uiLocale.effective)) return fail();
  if (!responseLanguageValues.includes(responseLanguage.requested) || !responseLanguageValues.includes(responseLanguage.effective)) return fail();
  if (!sourceValues.includes(uiLocale.source) || !sourceValues.includes(responseLanguage.source)) return fail();
  let saved: ControlLanguage["saved"] = null;
  if (value.saved !== null) {
    if (!record(value.saved)) return fail();
    const savedUi = check(value.saved.uiLocale);
    if (!uiLocaleValues.includes(savedUi)) return fail();
    const savedResponse = value.saved.responseLanguage;
    if (savedResponse !== null && (typeof savedResponse !== "string" || !responseLanguageValues.includes(savedResponse))) return fail();
    saved = { uiLocale: savedUi, responseLanguage: savedResponse };
  }
  const suggested = check(value.suggestedResponseLanguage);
  if (!responseLanguageValues.includes(suggested)) return fail();
  if (value.legacyProfile !== null && value.legacyProfile !== "core" && value.legacyProfile !== "ja") return fail();
  return { readable: value.readable, state: check(value.state), uiLocale, responseLanguage, saved, suggestedResponseLanguage: suggested, legacyProfile: value.legacyProfile };
}
export function parseControlState(value: unknown): ControlState {
  const fail = () => { throw new Error("Configuration service response is incompatible. Restart the development launcher and retry."); };
  if (!record(value)) return fail();
  if (value.schemaVersion !== 1 || !record(value.account) || typeof value.account.signedIn !== "boolean" || !(value.profile === null || typeof value.profile === "string")) return fail();
  if (value.modelReady !== undefined && typeof value.modelReady !== "boolean") return fail();
  if (value.account.revocation !== undefined && !["confirmed", "unconfirmed", "not-linked"].includes(value.account.revocation as string)) return fail();
  const fields = { credentials: ["providerId"], providers: ["id", "name"], models: ["provider", "id", "name"], customProviders: ["id"] };
  for (const [key, required] of Object.entries(fields)) {
    const rows = value[key];
    if (!Array.isArray(rows) || !rows.every(row => record(row) && required.every(field => typeof row[field] === "string" && (row[field] as string).length > 0))) return fail();
  }
  for (const row of value.customProviders as Record<string, unknown>[]) {
    if (typeof row.editable !== "boolean" || (row.editable && (typeof row.url !== "string" || typeof row.model !== "string"))) return fail();
  }
  for (const key of ["defaultProvider", "defaultModel"]) if (value[key] !== undefined && typeof value[key] !== "string") return fail();
  if (value.connectionCheck !== undefined && (!record(value.connectionCheck) || typeof value.connectionCheck.provider !== "string" || typeof value.connectionCheck.status !== "string")) return fail();
  if (value.language !== undefined) parseLanguage(value.language, fail);
  return value as unknown as ControlState;
}
