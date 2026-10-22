import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const directory = fileURLToPath(new URL('.', import.meta.url));
const native = { skip: process.platform !== 'win32' };
const pwsh = process.env.JOUZU_TEST_PWSH ?? 'powershell.exe';
const makensis = process.env.JOUZU_TEST_MAKENSIS;
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "jouzu prepare's "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const install = join(root, 'install');
  const helpers = join(install, 'runtime', 'launcher-update');
  const local = join(root, 'local');
  const logs = join(local, 'Shisa.ai', 'Jouzu', 'logs');
  mkdirSync(helpers, { recursive: true });
  for (const [component, archive] of [['git', 'PortableGit.exe'], ['terminal', 'WindowsTerminal.zip']]) {
    mkdirSync(join(install, 'runtime', component), { recursive: true });
    writeFileSync(join(install, 'runtime', component, archive), 'fixture');
  }
  const wrapper = join(helpers, 'prepare-component.ps1');
  if (existsSync(join(directory, 'prepare-component.ps1'))) copyFileSync(join(directory, 'prepare-component.ps1'), wrapper);
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.toLowerCase() === 'localappdata') delete env[key];
  env.LOCALAPPDATA = local;
  return { root, install, helpers, logs, env, wrapper };
}
function helper(space, component, body) {
  writeFileSync(join(space.helpers, `${component}-environment.ps1`), `param([string]$InstallRoot,[switch]$Prepare)
if (-not $Prepare) { throw 'Preparation switch missing' }
if (-not (Test-Path -LiteralPath $InstallRoot)) { throw 'Install root missing' }
${body}
`);
}
function prepare(space, component) {
  return spawnSync(pwsh, ['-NoProfile', '-NonInteractive', '-File', space.wrapper, '-Component', component, '-InstallRoot', space.install],
    { encoding: 'utf8', env: space.env, timeout: 20000, windowsHide: true });
}
const report = (space, component, failure = false) => JSON.parse(readFileSync(join(space.logs, `prepare-${component}${failure ? '.failure' : ''}.json`), 'utf8'));

test('preparation retains bounded sanitized failure evidence across a successful retry', native, t => {
  const space = fixture(t);
  const sentinel = join(space.install, 'runtime', 'git', 'working-copy.txt');
  writeFileSync(sentinel, 'working old copy');
  helper(space, 'git', `Write-Output ('failure' + [char]27 + [char]0x202e + ' token=private-value password=private-password')
[Console]::Error.WriteLine('preparation stderr')
Write-Output ('api_key="private quoted value" secret=''private single quoted value'' Bearer private-bearer https://private-user:private-pass@example.com ' + $InstallRoot)
Write-Output ('x' * 20000)
exit 7`);
  const failed = prepare(space, 'git');
  assert.equal(failed.status, 1, failed.stderr);
  assert.match(failed.stdout, /exit 7/);
  const original = report(space, 'git', true);
  assert.equal(original.exitCode, 7);
  assert.equal(original.status, 'failed');
  assert.match(original.detail, /failure/);
  assert.match(original.detail, /preparation stderr/);
  assert.ok(original.detail.length <= 4096);
  assert.doesNotMatch(original.detail, /[\u0000-\u001f\u007f\u202e]|private[- ]|jouzu prepare's/);
  assert.equal(readFileSync(sentinel, 'utf8'), 'working old copy');
  helper(space, 'git', "Write-Output 'prepared'; exit 0");
  assert.equal(prepare(space, 'git').status, 0);
  assert.equal(report(space, 'git').status, 'ready');
  assert.deepEqual(report(space, 'git', true), original);
});

test('preparation captures thrown errors and exposes failure to save diagnostics', native, t => {
  const space = fixture(t);
  helper(space, 'terminal', "throw 'fixture extraction failed'");
  assert.equal(prepare(space, 'terminal').status, 1);
  assert.match(report(space, 'terminal').detail, /fixture extraction failed/);
  assert.equal(report(space, 'terminal').exitCode, 1);
  rmSync(space.logs, { recursive: true });
  writeFileSync(space.logs, 'not a directory');
  const failed = prepare(space, 'terminal');
  assert.equal(failed.status, 1);
  assert.match(failed.stdout, /could not be saved/);
});

function installer(space, { passive = false, launcherOnly = false } = {}) {
  const executable = join(space.root, 'setup.exe');
  const source = join(space.root, 'setup.nsi');
  const nsisPath = value => value.replaceAll('$', '$$').replaceAll('"', '$\\"');
  writeFileSync(source, `Unicode true
!include MUI2.nsh
!include LogicLib.nsh
!define JOUZU_LAUNCHER_ONLY ${launcherOnly ? 1 : 0}
Var UpdateMode
Var PassiveMode
!include "${nsisPath(join(directory, 'installer-hooks.nsh'))}"
!insertmacro MUI_LANGUAGE English
!insertmacro MUI_LANGUAGE Japanese
!insertmacro MUI_LANGUAGE SimpChinese
!insertmacro MUI_LANGUAGE TradChinese
!include "${nsisPath(join(directory, 'installer-messages.nsh'))}"
Name "Preparation fixture"
OutFile "${nsisPath(executable)}"
RequestExecutionLevel user
Page instfiles
AutoCloseWindow true
Section
StrCpy $UpdateMode 1
StrCpy $PassiveMode ${passive ? 1 : 0}
!insertmacro NSIS_HOOK_POSTINSTALL
SectionEnd
`);
  const built = spawnSync(makensis, ['/V2', source], { encoding: 'utf8', timeout: 20000 });
  assert.equal(built.status, 0, built.stdout + built.stderr);
  // NSIS requires /D to be the last argument without quotes, including when its path has spaces.
  return () => spawnSync(executable, [...(passive ? [] : ['/S']), `/D=${space.install}`], {
    env: space.env, encoding: 'utf8', timeout: 20000, windowsHide: true, windowsVerbatimArguments: true,
  });
}

const nativeInstaller = { skip: process.platform !== 'win32' || !makensis };
test('full installer reports failed preparation, continues other components and accepts a retry', nativeInstaller, t => {
  const space = fixture(t);
  helper(space, 'git', "Write-Output 'Git fixture failed'; exit 7");
  helper(space, 'terminal', "Set-Content -LiteralPath (Join-Path $InstallRoot 'terminal-prepared.txt') -Value 'prepared'; exit 0");
  const run = installer(space);
  const failed = run();
  assert.equal(readFileSync(join(space.install, 'terminal-prepared.txt'), 'utf8').trim(), 'prepared');
  assert.equal(failed.status, 2, 'silent setup must report that component repair is needed');
  assert.equal(report(space, 'git', true).exitCode, 7);
  assert.equal(report(space, 'terminal').status, 'ready');
  helper(space, 'git', "Write-Output 'Git fixture prepared'; exit 0");
  assert.equal(run().status, 0);
  assert.equal(report(space, 'git').status, 'ready');
  assert.equal(report(space, 'git', true).exitCode, 7);
});

test('passive installer reports failure without waiting for a repair dialog', nativeInstaller, t => {
  const space = fixture(t);
  helper(space, 'git', "throw 'Git fixture failed'");
  helper(space, 'terminal', 'exit 0');
  assert.equal(installer(space, { passive: true })().status, 2);
  assert.equal(report(space, 'git').status, 'failed');
  assert.equal(report(space, 'terminal').status, 'ready');
});

test('launcher-only installer does not prepare runtime components', nativeInstaller, t => {
  const space = fixture(t);
  helper(space, 'git', "throw 'Unexpected Git preparation'");
  helper(space, 'terminal', "throw 'Unexpected Terminal preparation'");
  assert.equal(installer(space, { launcherOnly: true })().status, 0);
  assert.equal(existsSync(space.logs), false);
});
