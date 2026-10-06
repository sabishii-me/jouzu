import test from 'node:test';
import assert from 'node:assert/strict';
import { delimiter } from 'node:path';
import { sessionEnvironment } from './session-environment.mjs';

// The composition is what matters here, not the separator style Node happens to keep for the inputs it
// was handed, so both sides are read the same way.
const parts = value => value.split(delimiter).map(part => part.replaceAll(String.fromCharCode(92), '/'));


test('a managed session gets the carried runtime, the prepared Git Bash and the entries', () => {
  const environment = sessionEnvironment({
    app: 'C:/managed/updates/versions/1/app',
    shell: 'C:/managed/runtime/git/installed/bin/bash.exe',
    home: 'C:/managed/data',
    cacheDir: 'C:/managed/data/cache',
    configDir: 'C:/managed/data/config',
    entries: 'C:/managed/bin',
    node: 'C:/managed/runtime/node/node.exe',
    base: { PATH: 'C:/Windows/System32' },
  });
  // This installation's own commands answer first, then the runtime it carries, its tools, and the Git
  // Bash it prepared.
  assert.deepEqual(parts(environment.PATH), [
    'C:/managed/bin',
    'C:/managed/runtime/node',
    'C:/managed/updates/versions/1/tools',
    'C:/managed/runtime/git/installed/bin',
    'C:/managed/runtime/git/installed/cmd',
    'C:/managed/runtime/git/installed/usr/bin',
    'C:/Windows/System32',
  ]);
  assert.equal(environment.JOUZU_HOME.replaceAll(String.fromCharCode(92), '/'), 'C:/managed/data');
  assert.equal(environment.JOUZU_LAUNCHER_BASH.replaceAll(String.fromCharCode(92), '/'), 'C:/managed/runtime/git/installed/bin/bash.exe');
  assert.equal(environment.JOUZU_NO_UPDATE, '1');
  assert.equal(environment.PI_SKIP_VERSION_CHECK, '1');
  assert.equal(environment.npm_config_cache.replaceAll(String.fromCharCode(92), '/'), 'C:/managed/data/cache/npm');
  assert.equal(environment.npm_config_prefix.replaceAll(String.fromCharCode(92), '/'), 'C:/managed/data/config/npm');
});

test('a session without a Git Bash or an entry directory leaves them out', () => {
  const environment = sessionEnvironment({
    app: 'C:/app',
    shell: null,
    home: 'C:/data',
    cacheDir: 'C:/data/cache',
    configDir: 'C:/data/config',
    node: 'C:/node/node.exe',
    base: { PATH: 'C:/Windows' },
  });
  assert.deepEqual(parts(environment.PATH), ['C:/node', 'C:/tools', 'C:/Windows']);
  assert.equal(environment.JOUZU_LAUNCHER_BASH, undefined);
});
