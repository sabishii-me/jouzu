// Private, JSON-only adapter to the installed Jouzu configuration implementation.
// Requests arrive through stdin, never command-line arguments containing secrets.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync, existsSync, unlinkSync } from 'node:fs';
import { createRequire } from 'node:module';
const root = process.argv[1]?.endsWith("control.mjs") ? process.argv[2] : process.argv[1];
const appRoot = process.argv[1]?.endsWith('control.mjs') ? (process.argv[3] || join(root, 'app')) : (process.argv[2] || join(root, 'app'));
const load = name => import(pathToFileURL(join(appRoot, 'node_modules/jouzu/dist', `${name}.js`)));
let action = "status";
// Remote revocation is advisory: a saved sign-out still clears local credentials.
let signOutRevocation;
try {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  action = request.action;
  const { resolveJouzuPaths } = await load('paths');
  const paths = resolveJouzuPaths({ homeOverride: process.env.JOUZU_HOME });
  const { readProfileChoice, writeProfileChoice } = await load('profile-choice');
  const agentRoot = join(appRoot, 'node_modules/@earendil-works/pi-coding-agent/dist');
  const pi = name => import(pathToFileURL(join(agentRoot, 'core', `${name}.js`)));
  const { AuthStorage } = await pi('auth-storage');
  const { ModelRuntime } = await pi('model-runtime');
  const { SettingsManager } = await pi('settings-manager');
  const auth = AuthStorage.create(join(paths.agentDir, 'auth.json'));
  const settings = SettingsManager.create(paths.configDir, paths.agentDir);
  const runtime = await ModelRuntime.create({ authPath: join(paths.agentDir, 'auth.json'), modelsPath: join(paths.agentDir, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
  const profilePath = join(paths.stateDir, 'profile-choice.json');
  if (request.action === 'profile') {
    if (!['core', 'ja'].includes(request.profile)) throw new Error('Invalid profile');
    const { loadBundledProfile } = await load('profiles');
    const { applyProfile } = await load('profile-manager');
    const { loadMetadata } = await load('metadata');
    applyProfile(loadBundledProfile(request.profile), paths, loadMetadata().jouzuVersion);
    writeProfileChoice(profilePath, request.profile);
  } else if (request.action === 'import') {
    if (typeof request.accept !== 'boolean') throw new Error('Invalid import decision');
    const { offerPiConfigurationImport } = await load('pi-import');
    await offerPiConfigurationImport(paths, {
      inheritedAgentDir: process.env.PI_CODING_AGENT_DIR,
      ask: async () => request.accept ? 'yes' : 'no',
      output: { write: () => true },
    });
  } else if (request.action === 'shisa-login') {
    const { loginShisa } = await load('shisa-link/login');
    const { resolveShisaGatewayUrl } = await load('shisa-link/device-flow');
    const { loadMetadata } = await load('metadata');
    await loginShisa({
      signal: AbortSignal.timeout(180000),
      onDeviceCode: ({ verificationUri, userCode }) => process.stderr.write(JSON.stringify({ type: 'device', url: verificationUri, code: userCode }) + String.fromCharCode(10)),
      onAuth: () => {}, onProgress: () => {}, onSelect: async () => undefined,
      onPrompt: async () => { throw new Error('Unsupported interactive prompt'); },
    }, { paths, gatewayUrl: resolveShisaGatewayUrl(process.env), jouzuVersion: loadMetadata().jouzuVersion });
  } else if (request.action === 'shisa-logout') {
    const { logoutShisa } = await load('shisa-link/logout');
    const result = await logoutShisa({ paths });
    if (!result.localCleared) throw new Error('Local signout failed');
    signOutRevocation = result.revocation;
  } else if (request.action === 'custom-provider') {
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(request.provider) || request.provider === 'shisa') throw new Error('Invalid provider');
    const url = new URL(request.url);
    if (url.username || url.password || !(['https:'].includes(url.protocol) || (url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname)))) throw new Error('Invalid endpoint');
    if (typeof request.model !== 'string' || !request.model.trim() || request.model.length > 256) throw new Error('Invalid model');
    const { ensurePrivateDirectory, writeFilePrivateAtomic } = await load('private-fs');
    ensurePrivateDirectory(paths.agentDir);
    const file = join(paths.agentDir, 'models.json');
    const require = createRequire(join(appRoot, 'node_modules/jouzu/package.json'));
    const lock = require('proper-lockfile');
    const release = await lock.lock(file, { realpath: false, retries: 0 });
    const staged = join(paths.agentDir, 'models.launcher-validation.json');
    try {
      const config = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { providers: {} };
      config.providers ??= {};
      const existing = config.providers[request.provider];
      if (request.edit !== true && (existing || runtime.getProvider(request.provider))) throw new Error('Provider already exists');
      if (request.edit === true && (!existing || existing.api !== 'openai-completions' || existing.models?.length !== 1)) throw new Error('This provider requires advanced editing');
      config.providers[request.provider] = { ...existing, baseUrl: url.href, api: 'openai-completions', authHeader: true, models: [{ ...existing?.models?.[0], id: request.model.trim(), name: request.model.trim(), reasoning: false, input: ['text'], cost: {input:0,output:0,cacheRead:0,cacheWrite:0}, contextWindow: 32768, maxTokens: 4096, ...existing?.models?.[0], id: request.model.trim(), name: request.model.trim() }] };
      writeFilePrivateAtomic(staged, JSON.stringify(config), paths.agentDir);
      const { ModelConfig } = await pi('model-config');
      const validated = await ModelConfig.load(staged);
      if (validated.getError()) throw new Error('Invalid model configuration');
      writeFilePrivateAtomic(file, JSON.stringify(config, null, 2), paths.agentDir);
    } finally {
      if (existsSync(staged)) unlinkSync(staged);
      await release();
    }
  } else if (request.action === 'provider-key') {
    if (!runtime.getProvider(request.provider)) throw new Error('Unknown provider');
    if (typeof request.token !== 'string' || !request.token.trim() || /^[!$]/.test(request.token.trim()) || request.token.length > 8192 || [...request.token].some(c => c.charCodeAt(0) < 32)) throw new Error('Invalid key');
    await auth.modify(request.provider, async () => ({ type: 'api_key', key: request.token.trim() }));
  } else if (request.action === 'provider-remove') {
    if (!runtime.getProvider(request.provider)) throw new Error('Unknown provider');
    await auth.delete(request.provider);
  } else if (request.action === 'default-model') {
    if (!runtime.getModel(request.provider, request.model)) throw new Error('Unknown model');
    settings.setDefaultModelAndProvider(request.provider, request.model);
    await settings.flush();
  } else if (request.action !== 'status') throw new Error('Unsupported operation');
  if (request.action === "custom-provider") await runtime.refresh({ allowNetwork: false });
  const { ModelConfig } = await pi('model-config');
  const savedConfig = await ModelConfig.load(join(paths.agentDir, 'models.json'));
  const customProviders = savedConfig.getProviderIds().map(id => {
    const p = savedConfig.getProvider(id);
    return { id, url: p.baseUrl, model: p.models?.[0]?.id, editable: p.api === 'openai-completions' && p.models?.length === 1 };
  });
  const { readShisaAccountStatus } = await load('shisa-link/account');
  const currentRuntime = await ModelRuntime.create({ authPath: join(paths.agentDir, 'auth.json'), modelsPath: join(paths.agentDir, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
  const availableModels = await currentRuntime.getAvailable();
  console.log(JSON.stringify({ schemaVersion: 1, modelReady: availableModels.length > 0, profile: readProfileChoice(profilePath)?.profile ?? null, account: { ...readShisaAccountStatus(paths), ...(signOutRevocation ? { revocation: signOutRevocation } : {}) }, customProviders, providers: runtime.getProviders().map(p => ({ id: p.id, name: p.name ?? p.id })), credentials: await auth.list(), models: runtime.getModels().map(m => ({ provider: m.provider, id: m.id, name: m.name })), defaultProvider: settings.getDefaultProvider(), defaultModel: settings.getDefaultModel() }));
} catch {
  // Do not relay raw upstream errors: they can contain credentials or server input.
  const messages = {
    status: 'Could not read Jouzu configuration. No settings were changed.',
    profile: 'Could not apply the Jouzu profile. Existing profile files may conflict; the selection was not marked complete.',
    'provider-key': 'Could not save the provider key. Check the provider selection and retry.',
    'provider-remove': 'Could not remove the provider key. Refresh its state before retrying.',
    'custom-provider': 'Could not save the custom connection. Check its unique ID, endpoint and model. Existing advanced configurations cannot be edited with this form.',
    'default-model': 'Could not save the default model. Refresh the model list and retry.',
    'shisa-login': 'Shisa sign-in did not complete. Refresh its state before retrying.',
    'shisa-logout': 'Shisa sign-out could not be fully confirmed. Refresh its state and check the Shisa dashboard.',
  };
  console.log(JSON.stringify({ error: messages[action] ?? 'Unsupported configuration operation.' }));
  process.exitCode = 1;
}
