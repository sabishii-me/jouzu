import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { launcherNotes } from './launcher-notes.mjs';

const changelog = readFileSync(new URL('../../apps/launcher/CHANGELOG.md', import.meta.url), 'utf8');

test('every released launcher version has update notes', () => {
	const notes = launcherNotes(changelog, '0.3.0');
	assert.match(notes, /built and signed by CI/);
	// A section ends at the next version heading, so notes never leak another release's text.
	assert.doesNotMatch(notes, /## 0\.2\.0/);
	assert.doesNotMatch(notes, /Jouzu application payload/);
});

test('a missing or empty section is refused instead of shipping an empty note', () => {
	assert.throws(() => launcherNotes(changelog, '9.9.9'), /Missing changelog section/);
	assert.throws(() => launcherNotes('# Launcher changelog\n\n## 1.0.0\n\n## 0.9.0\n', '1.0.0'), /Empty changelog section/);
	assert.throws(() => launcherNotes(changelog, 'v0.3.0'), /Invalid launcher version/);
});
