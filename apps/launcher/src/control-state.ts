export interface ControlState {
  modelReady?: boolean;
  connectionCheck?: { provider: string; status: string };
  profile: string | null;
  account: { signedIn: boolean };
  customProviders: { id: string; url: string; model: string; editable: boolean }[];
  providers: { id: string; name: string }[];
  credentials: { providerId: string }[];
  models: { provider: string; id: string; name: string }[];
  defaultProvider?: string;
  defaultModel?: string;
}
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
export function parseControlState(value: unknown): ControlState {
  const fail = () => { throw new Error("Configuration service response is incompatible. Restart the development launcher and retry."); };
  if (!record(value)) return fail();
  if (value.schemaVersion !== 1 || !record(value.account) || typeof value.account.signedIn !== "boolean" || !(value.profile === null || typeof value.profile === "string")) return fail();
  if (value.modelReady !== undefined && typeof value.modelReady !== "boolean") return fail();
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
  return value as unknown as ControlState;
}
