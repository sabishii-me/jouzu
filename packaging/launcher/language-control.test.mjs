import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const control = fileURLToPath(new URL('./control.mjs', import.meta.url));

const modules = {
  'paths.js': `import { join } from 'node:path';
export function resolveJouzuPaths({ homeOverride }) {
  const root = homeOverride;
  return { configDir: root, agentDir: join(root,'agent'), stateDir: join(root,'state'), cacheDir: join(root,'cache'), sessionDir: join(root,'state','sessions'), profileStatePath: join(root,'state','profile-state.json'), backupDir: join(root,'state','backups') };
}`,
  'profile-choice.js': `import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export function readProfileChoice(path) { if (!existsSync(path)) return undefined; return JSON.parse(readFileSync(path,'utf8')); }
export function writeProfileChoice(path, profile) { mkdirSync(dirname(path),{recursive:true}); writeFileSync(path, JSON.stringify({schemaVersion:1,profile,chosenAt:new Date().toISOString()})); }`,
  'ui-locale.js': `import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
const LOCALES = ['en','ja','zh-Hans','zh-Hant'];
export function isUiLocalePreference(value) { return value === 'auto' || LOCALES.includes(value); }
export function osLocaleCandidates(env) { return [env.LC_ALL, env.LC_MESSAGES, env.LANG]; }
function normalize(value) {
  if (!value) return undefined;
  const base = value.replace(/[.@].*$/, '').replace(/_/g, '-');
  if (/^en/i.test(base)) return 'en';
  if (/^ja/i.test(base)) return 'ja';
  if (/^zh-hans/i.test(base)) return 'zh-Hans';
  if (/^zh-hant/i.test(base)) return 'zh-Hant';
  return undefined;
}
function snapshot(configDir) {
  const path = join(configDir, 'localization.json');
  if (!existsSync(path)) return { state: { status: 'absent' }, revision: { kind: 'absent' } };
  const contents = readFileSync(path, 'utf8');
  let parsed;
  try { parsed = JSON.parse(contents); } catch { return { state: { status: 'invalid', reason: 'invalid json' }, revision: { kind: 'rejected', reason: 'invalid json' } }; }
  const localization = parsed?.localization;
  if (!localization || (localization.uiLocale !== 'auto' && !LOCALES.includes(localization.uiLocale))) return { state: { status: 'invalid', reason: 'invalid settings' }, revision: { kind: 'rejected', reason: 'invalid settings' } };
  return { state: { status: 'ok', preference: localization.uiLocale }, revision: { kind: 'file', contents } };
}
export function readLocalizationConfigSnapshot(configDir) { return snapshot(configDir); }
export function readLocalizationSettings(configDir) {
  const current = snapshot(configDir);
  if (current.state.status === 'absent') return { status: 'absent' };
  if (current.state.status !== 'ok') return { status: 'invalid', reason: 'invalid settings' };
  const localization = JSON.parse(readFileSync(join(configDir, 'localization.json'), 'utf8')).localization;
  return { status: 'ok', preference: localization.uiLocale, settings: { schemaVersion: 2, uiLocale: localization.uiLocale, ...(localization.responseLanguage ? { responseLanguage: localization.responseLanguage } : {}), ...(localization.artifactPolicy ? { artifactPolicy: localization.artifactPolicy } : {}) } };
}
export function resolveUiLocale({ config, env, os } = {}) {
  if (config?.status === 'ok' && config.preference !== 'auto') return { requested: config.preference, effective: config.preference, source: 'config' };
  const candidates = [...(env ? [env] : []), ...(os ?? [])];
  for (const candidate of candidates) { const match = normalize(candidate); if (match) return { requested: 'auto', effective: match, source: 'os' }; }
  return { requested: 'auto', effective: 'en', source: 'builtin' };
}
export function saveLocalizationConfig(location, preference, snapshot, catalog, patch = {}) {
  const path = join(location.configDir, 'localization.json');
  const current = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')).localization ?? {} : {};
  const next = { schemaVersion: 2, localization: { ...current, uiLocale: preference } };
  if (patch.responseLanguage !== undefined) next.localization.responseLanguage = patch.responseLanguage;
  const contents = JSON.stringify(next, null, 2) + String.fromCharCode(10);
  mkdirSync(location.configDir, { recursive: true });
  writeFileSync(path, contents);
  return { state: { status: 'ok', preference }, revision: { kind: 'file', contents } };
}`,
  'language-settings.js': `const LANGUAGES = ['en','ja','zh-Hans','zh-Hant'];
export function isResponseLanguagePreference(value) { return value === 'auto' || LANGUAGES.includes(value); }
export function resolveResponseLanguage({ config } = {}) { return { requested: config ?? 'auto', effective: config ?? 'auto', source: config ? 'config' : 'builtin' }; }`,
  'shisa-link/account.js': `export function readShisaAccountStatus() { return { signedIn: false }; }`,
};

const piModules = {
  'auth-storage.js': `export const AuthStorage = { create() { return { list: async () => [], modify: async () => {}, delete: async () => {} }; } };`,
  'model-runtime.js': `export const ModelRuntime = { async create() { return { getProviders: () => [{ id: 'openai', name: 'OpenAI' }], getModels: () => [], getProvider: () => undefined, getModel: () => undefined, refresh: async () => {} }; } };`,
  'settings-manager.js': `export const SettingsManager = { create() { return { getDefaultProvider: () => undefined, getDefaultModel: () => undefined, setDefaultModelAndProvider() {}, flush: async () => {} }; } };`,
  'model-config.js': `export const ModelConfig = { async load() { return { getProviderIds: () => [], getProvider: () => undefined, getError: () => undefined }; } };`,
};

function stage() {
  const root = mkdtempSync(join(tmpdir(), 'jouzu-language-'));
  const app = join(root, 'app');
  const home = join(root, 'home');
  mkdirSync(join(app, 'node_modules', 'jouzu', 'dist', 'shisa-link'), { recursive: true });
  mkdirSync(join(app, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'core'), { recursive: true });
  writeFileSync(join(app, 'node_modules', 'jouzu', 'package.json'), '{"name":"jouzu","type":"module"}');
  writeFileSync(join(app, 'node_modules', '@earendil-works', 'pi-coding-agent', 'package.json'), '{"name":"@earendil-works/pi-coding-agent","type":"module"}');
  for (const [name, source] of Object.entries(modules)) writeFileSync(join(app, 'node_modules', 'jouzu', 'dist', name), source);
  for (const [name, source] of Object.entries(piModules)) writeFileSync(join(app, 'node_modules', '@earendil-works', 'pi-coding-agent', 'dist', 'core', name), source);
  mkdirSync(home, { recursive: true });
  return { root, app, home, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function run(ctx, request) {
  const result = spawnSync(process.execPath, [control, ctx.app, ctx.app], {
    input: JSON.stringify(request),
    encoding: 'utf8',
    env: { ...process.env, JOUZU_HOME: ctx.home, LC_ALL: '', LC_MESSAGES: '', LANG: '' },
  });
  const body = JSON.parse(result.stdout);
  return { code: result.status, body };
}

function settingsPath(ctx) {
  return join(ctx.home, 'localization.json');
}

test('status reports absent settings and the effective interface language', () => {
  const ctx = stage();
  try {
    const { body } = run(ctx, { action: 'status' });
    assert.equal(body.language.readable, true);
    assert.equal(body.language.state, 'absent');
    assert.equal(body.language.uiLocale.requested, 'auto');
    assert.equal(body.language.uiLocale.effective, 'en');
    assert.equal(body.language.suggestedResponseLanguage, 'auto');
    assert.equal(body.language.legacyProfile, null);
    assert.equal(body.profile, null);
  } finally { ctx.cleanup(); }
});

test('a saved Japanese profile suggests the Japanese response language', () => {
  const ctx = stage();
  try {
    mkdirSync(join(ctx.home, 'state'), { recursive: true });
    writeFileSync(join(ctx.home, 'state', 'profile-choice.json'), '{"schemaVersion":1,"profile":"ja","chosenAt":"2026-10-28T00:00:00.000Z"}');
    const { body } = run(ctx, { action: 'status' });
    assert.equal(body.language.legacyProfile, 'ja');
    assert.equal(body.language.suggestedResponseLanguage, 'ja');
  } finally { ctx.cleanup(); }
});

test('language-set writes both settings and returns the new state', () => {
  const ctx = stage();
  try {
    const { code, body } = run(ctx, { action: 'language-set', uiLocale: 'ja', responseLanguage: 'zh-Hans' });
    assert.equal(code, 0);
    assert.equal(body.language.saved.uiLocale, 'ja');
    assert.equal(body.language.saved.responseLanguage, 'zh-Hans');
    const saved = JSON.parse(readFileSync(settingsPath(ctx), 'utf8'));
    assert.equal(saved.schemaVersion, 2);
    assert.equal(saved.localization.uiLocale, 'ja');
    assert.equal(saved.localization.responseLanguage, 'zh-Hans');
  } finally { ctx.cleanup(); }
});

test('a response-only change keeps the saved interface language and artifact policy', () => {
  const ctx = stage();
  try {
    writeFileSync(settingsPath(ctx), JSON.stringify({
      schemaVersion: 2,
      localization: {
        uiLocale: 'ja',
        responseLanguage: 'ja',
        artifactPolicy: { comments: 'preserve', documentation: 'ja', commits: 'ja', reviews: 'preserve' },
      },
    }, null, 2));
    const { code } = run(ctx, { action: 'language-set', responseLanguage: 'en' });
    assert.equal(code, 0);
    const saved = JSON.parse(readFileSync(settingsPath(ctx), 'utf8'));
    assert.equal(saved.localization.uiLocale, 'ja');
    assert.equal(saved.localization.responseLanguage, 'en');
    assert.deepEqual(saved.localization.artifactPolicy, { comments: 'preserve', documentation: 'ja', commits: 'ja', reviews: 'preserve' });
  } finally { ctx.cleanup(); }
});

test('an interface-only change keeps the saved response language', () => {
  const ctx = stage();
  try {
    writeFileSync(settingsPath(ctx), JSON.stringify({
      schemaVersion: 2,
      localization: { uiLocale: 'en', responseLanguage: 'ja' },
    }, null, 2));
    const { code } = run(ctx, { action: 'language-set', uiLocale: 'zh-Hans' });
    assert.equal(code, 0);
    const saved = JSON.parse(readFileSync(settingsPath(ctx), 'utf8'));
    assert.equal(saved.localization.uiLocale, 'zh-Hans');
    assert.equal(saved.localization.responseLanguage, 'ja');
  } finally { ctx.cleanup(); }
});

test('unsupported values are refused without writing', () => {
  const ctx = stage();
  try {
    const { code, body } = run(ctx, { action: 'language-set', uiLocale: 'fr' });
    assert.equal(code, 1);
    assert.match(body.error, /Could not save/);
    assert.equal(existsSyncSafe(settingsPath(ctx)), false);
  } finally { ctx.cleanup(); }
});

test('an unreadable settings file is refused and left byte-identical', () => {
  const ctx = stage();
  try {
    const malformed = '{not json';
    writeFileSync(settingsPath(ctx), malformed);
    const before = readFileSync(settingsPath(ctx));
    const { code, body } = run(ctx, { action: 'language-set', responseLanguage: 'ja' });
    assert.equal(code, 1);
    assert.match(body.error, /Could not save/);
    assert.deepEqual(readFileSync(settingsPath(ctx)), before);
  } finally { ctx.cleanup(); }
});

function existsSyncSafe(path) {
  try { readFileSync(path); return true; } catch { return false; }
}
