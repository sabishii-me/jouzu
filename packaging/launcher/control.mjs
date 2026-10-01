// Private, JSON-only adapter to the installed Jouzu configuration implementation.
// Requests arrive through stdin, never command-line arguments containing secrets.
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readFileSync } from 'node:fs';
const root = process.argv[1]?.endsWith("control.mjs") ? process.argv[2] : process.argv[1];
const load = name => import(pathToFileURL(join(root, 'app/node_modules/jouzu/dist', `${name}.js`)));
try {
  const request = JSON.parse(readFileSync(0, 'utf8'));
  const { resolveJouzuPaths } = await load('paths');
  const paths = resolveJouzuPaths({ homeOverride: process.env.JOUZU_HOME });
  const { readProfileChoice, writeProfileChoice } = await load('profile-choice');
  const agentRoot = join(root, 'app/node_modules/@earendil-works/pi-coding-agent/dist');
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
  } else if (request.action === 'provider-key') {
    if (!runtime.getProvider(request.provider)) throw new Error('Unknown provider');
    if (typeof request.token !== 'string' || !request.token.trim() || request.token.length > 8192 || [...request.token].some(c => c.charCodeAt(0) < 32)) throw new Error('Invalid key');
    await auth.modify(request.provider, async () => ({ type: 'api_key', key: request.token.trim() }));
  } else if (request.action === 'provider-remove') {
    if (!runtime.getProvider(request.provider)) throw new Error('Unknown provider');
    await auth.delete(request.provider);
  } else if (request.action === 'default-model') {
    if (!runtime.getModel(request.provider, request.model)) throw new Error('Unknown model');
    settings.setDefaultModelAndProvider(request.provider, request.model);
    await settings.flush();
  } else if (request.action !== 'status') throw new Error('Unsupported operation');
  const { readShisaAccountStatus } = await load('shisa-link/account');
  console.log(JSON.stringify({ profile: readProfileChoice(profilePath)?.profile ?? null, account: readShisaAccountStatus(paths), providers: runtime.getProviders().map(p => ({ id: p.id, name: p.name ?? p.id })), credentials: await auth.list(), models: runtime.getModels().map(m => ({ provider: m.provider, id: m.id, name: m.name })), defaultProvider: settings.getDefaultProvider(), defaultModel: settings.getDefaultModel() }));
} catch {
  // Do not relay raw upstream errors: they can contain credentials or server input.
  console.log(JSON.stringify({ error: 'Configuration operation failed. Check data permissions and configuration conflicts.' }));
  process.exitCode = 1;
}
