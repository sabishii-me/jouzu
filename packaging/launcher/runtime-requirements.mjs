import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PNPM_VERSION } from './prepare-starter.mjs';

export const NODE_VERSION = '24.22.1';
export const RUNTIME_REPAIR_CODE = 'JOUZU_RUNTIME_REPAIR_REQUIRED';
export const RUNTIME_REPAIR_MESSAGE = 'Jouzu needs an updated Node and pnpm runtime. Close Jouzu sessions and run the full Windows installer in the existing installation folder, without uninstalling first. Launcher-only updates and Repair Jouzu do not update Node or pnpm.';

/** An application recipe never supplies or updates the executables that install it. */
export function assertUpdateRuntime(runtime, execute = spawnSync) {
 try {
  const metadata = JSON.parse(readFileSync(join(runtime, 'pnpm/package.json'), 'utf8'));
  if (metadata.name !== 'pnpm' || metadata.version !== PNPM_VERSION) throw new Error('Wrong pnpm package');
  const node = join(runtime, 'node', process.platform === 'win32' ? 'node.exe' : 'bin/node');
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const options = { cwd: runtime, env, encoding: 'utf8', windowsHide: true, timeout: 10000, maxBuffer: 64 * 1024 };
  const nodeResult = execute(node, ['--version'], options);
  const version = /^v(\d+)\.(\d+)\.(\d+)$/.exec(nodeResult.stdout?.trim() ?? '');
  const [major, minor, patch] = NODE_VERSION.split('.').map(Number);
  if (nodeResult.error || nodeResult.status !== 0 || !version || Number(version[1]) !== major || Number(version[2]) < minor || (Number(version[2]) === minor && Number(version[3]) < patch)) throw new Error('Unsupported Node version');
  const pnpmResult = execute(node, [join(runtime, 'pnpm/bin/pnpm.cjs'), '--version', '--config.manage-package-manager-versions=false'], options);
  if (pnpmResult.error || pnpmResult.status !== 0 || pnpmResult.stdout?.trim() !== PNPM_VERSION) throw new Error('Wrong pnpm executable');
 } catch {
  const error = new Error(RUNTIME_REPAIR_MESSAGE);
  error.code = RUNTIME_REPAIR_CODE;
  throw error;
 }
}
