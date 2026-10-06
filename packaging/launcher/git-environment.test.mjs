import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, linkSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const script = fileURLToPath(new URL('./git-environment.ps1', import.meta.url));
const pwsh = process.env.JOUZU_TEST_PWSH ?? 'pwsh';
// The script accepts a Git tree only when both executables carry a valid Authenticode signature and
// answer --version, so a fixture stands in the signed Node binary this suite already runs under. It is
// hard-linked rather than copied: the signature covers the file contents, which a link shares.
const signedBinary = process.execPath;
function place(source, target) {
  try { linkSync(source, target); }
  catch { copyFileSync(source, target); }
}

function gitTree(root) {
  mkdirSync(join(root, 'bin'), { recursive: true });
  mkdirSync(join(root, 'cmd'), { recursive: true });
  place(signedBinary, join(root, 'bin', 'bash.exe'));
  place(signedBinary, join(root, 'cmd', 'git.exe'));
  return root;
}
function unsignedTree(root) {
  mkdirSync(join(root, 'bin'), { recursive: true });
  mkdirSync(join(root, 'cmd'), { recursive: true });
  writeFileSync(join(root, 'bin', 'bash.exe'), 'not a program');
  writeFileSync(join(root, 'cmd', 'git.exe'), 'not a program');
  return root;
}
function workspace(prefix) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  return { root, install: join(root, 'install'), local: join(root, 'local'), machine: join(root, 'machine') };
}
// Windows environment names are case-insensitive, so an override has to replace every existing
// spelling; adding PATH beside an inherited Path leaves whichever Windows reads first.
function withEnv(overrides) {
  const env = { ...process.env };
  for (const [name, value] of Object.entries(overrides)) {
    for (const key of Object.keys(env)) if (key.toLowerCase() === name.toLowerCase()) delete env[key];
    env[name] = value;
  }
  return env;
}
function run(args, env) {
  return spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', script, ...args], {
    encoding: 'utf8',
    windowsHide: true,
    env: withEnv(env),
  });
}
// A machine copy is reported when a directory on PATH holds git.exe beside its tree. What this PC has
// installed decides which copy that is, so the assertions below state which location is used, never
// which Git it happened to be.
function machineEnv(space) {
  return {
    PATH: [join(space.machine, 'cmd'), process.env.PATH].join(';'),
    LOCALAPPDATA: space.local,
  };
}

test('a launch uses the copy Jouzu ships, ahead of the machine copy', () => {
  const space = workspace('git-bundled-');
  const bundled = gitTree(join(space.install, 'runtime', 'git', 'installed'));
  gitTree(space.machine);
  const result = run(['-InstallRoot', space.install], machineEnv(space));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), join(bundled, 'bin', 'bash.exe'));
});

test('a launch falls back to the machine copy, and preparation never does', () => {
  const space = workspace('git-machine-');
  gitTree(space.machine);
  const env = machineEnv(space);
  const launch = run(['-InstallRoot', space.install], env);
  assert.equal(launch.status, 0, launch.stderr);
  assert.ok(launch.stdout.trim().endsWith(join('bin', 'bash.exe')), launch.stdout);

  // Preparation needs the copy Jouzu ships, so it fails without printing the machine's copy.
  const prepare = run(['-InstallRoot', space.install, '-Prepare'], env);
  assert.notEqual(prepare.status, 0);
  assert.equal(prepare.stdout.trim(), '');
});

test('the managed copy answers a launch that has no bundled copy', () => {
  const space = workspace('git-managed-');
  const managed = gitTree(join(space.local, 'Shisa.ai', 'Jouzu', 'tools', 'git'));
  const result = run(['-InstallRoot', space.install], machineEnv(space));
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), join(managed, 'bin', 'bash.exe'));
});

test('an unsigned tree is not a copy', () => {
  const space = workspace('git-unsigned-');
  unsignedTree(join(space.install, 'runtime', 'git', 'installed'));
  const report = run(['-InstallRoot', space.install, '-Report'], machineEnv(space));
  assert.equal(report.status, 0, report.stderr);
  assert.equal(JSON.parse(report.stdout).bundled, null);
  const prepare = run(['-InstallRoot', space.install, '-Prepare'], machineEnv(space));
  assert.notEqual(prepare.status, 0);
  assert.equal(prepare.stdout.trim(), '');
});

test('the report names every location and the version it read', () => {
  const space = workspace('git-report-');
  gitTree(join(space.install, 'runtime', 'git', 'installed'));
  gitTree(join(space.local, 'Shisa.ai', 'Jouzu', 'tools', 'git'));
  gitTree(space.machine);
  const result = run(['-InstallRoot', space.install, '-Report'], machineEnv(space));
  assert.equal(result.status, 0, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.bundled.path, join(space.install, 'runtime', 'git', 'installed', 'bin', 'bash.exe'));
  assert.equal(report.managed.path, join(space.local, 'Shisa.ai', 'Jouzu', 'tools', 'git', 'bin', 'bash.exe'));
  assert.ok(report.system.path.endsWith(join('bin', 'bash.exe')), report.system.path);
  assert.ok(report.system.path.endsWith(join('bin', 'bash.exe')), report.system.path);
  assert.equal(report.bundled.git, report.bundled.bash);
  assert.equal(report.archive, false);
});
