import test from 'node:test';
import assert from 'node:assert/strict';
import { releaseNotesSection, repositorySlug, fetchReleaseNotes } from './jouzu-notes.mjs';

const changelog = `# Changelog\n\n## 0.1.18 - 2026-09-30\n\n### Changed\n\n- Show background jobs in the work dashboard.\n\n### Fixed\n\n- Continue a running loop after a non-loop turn.\n\n## 0.1.17 - 2026-09-29\n\n- Older notes.\n`;

test('the notes cover one version only', () => {
	const notes = releaseNotesSection(changelog, '0.1.18');
	assert.match(notes, /background jobs/);
	assert.match(notes, /Continue a running loop/);
	assert.doesNotMatch(notes, /Older notes/);
	assert.equal(releaseNotesSection(changelog, '0.0.1'), null);
});

test('the repository comes from published metadata', () => {
	assert.deepEqual(repositorySlug({ repository: { url: 'git+https://github.com/shisa-ai/jouzu.git' } }), { owner: 'shisa-ai', repo: 'jouzu' });
	assert.deepEqual(repositorySlug({ repository: 'github:shisa-ai/jouzu' }), { owner: 'shisa-ai', repo: 'jouzu' });
	assert.throws(() => repositorySlug({}), /GitHub repository/);
});

test('missing notes become an explicit marker instead of an empty description', async () => {
	const metadata = { repository: 'https://github.com/shisa-ai/jouzu.git', gitHead: '5'.repeat(40) };
	const ok = await fetchReleaseNotes({ metadata, version: '0.1.18', fetchImpl: async () => ({ ok: true, text: async () => changelog }) });
	assert.match(ok.notes, /background jobs/);
	assert.equal(ok.notesSource, `shisa-ai/jouzu@${'5'.repeat(7)} CHANGELOG.md`);
	const missing = await fetchReleaseNotes({ metadata, version: '0.1.18', fetchImpl: async () => ({ ok: false }) });
	assert.equal(missing.notes, '');
	assert.match(missing.notesSource, /^unavailable \(shisa-ai\/jouzu@/);
	const noCommit = await fetchReleaseNotes({ metadata: { repository: 'https://github.com/shisa-ai/jouzu' }, version: '0.1.18', fetchImpl: async () => ({ ok: true, text: async () => changelog }) });
	assert.match(noCommit.notesSource, /^unavailable/);
});
