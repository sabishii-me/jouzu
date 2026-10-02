import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// The Launcher update item shows the changelog section for the released version, so a release
// cannot ship a feed entry that says nothing about what changed.
export function launcherNotes(changelog, version) {
	if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Invalid launcher version');
	const lines = changelog.split(/\r?\n/);
	const start = lines.findIndex(line => line.trim() === `## ${version}`);
	if (start === -1) throw new Error(`Missing changelog section for ${version}`);
	const body = [];
	for (const line of lines.slice(start + 1)) {
		if (line.startsWith('## ')) break;
		body.push(line);
	}
	const notes = body.join('\n').trim();
	if (!notes) throw new Error(`Empty changelog section for ${version}`);
	return notes;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	const [changelogFile, version] = process.argv.slice(2);
	if (!changelogFile || !version) throw new Error('Usage: node launcher-notes.mjs <changelog> <version>');
	process.stdout.write(launcherNotes(readFileSync(changelogFile, 'utf8'), version));
}
