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
  } else if (request.action !== 'status') throw new Error('Unsupported operation');
  const { readShisaAccountStatus } = await load('shisa-link/account');
  console.log(JSON.stringify({ profile: readProfileChoice(profilePath)?.profile ?? null, account: readShisaAccountStatus(paths) }));
} catch {
  // Do not relay raw upstream errors: they can contain credentials or server input.
  console.log(JSON.stringify({ error: 'Configuration operation failed. Check data permissions and configuration conflicts.' }));
  process.exitCode = 1;
}
