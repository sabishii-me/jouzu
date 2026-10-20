import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./check-release-metadata.mjs", import.meta.url));
const root = fileURLToPath(new URL("..", import.meta.url));
const realLock = JSON.parse(readFileSync(join(root, "upstream", "pi.lock.json"), "utf8"));
const validRealLock = {
	...realLock,
	reviewedAt: realLock.reviewedAt ?? "2026-09-05",
	compatibilityStatus: "qualified",
};
const realCliPackage = JSON.parse(readFileSync(join(root, "packages", "cli", "package.json"), "utf8"));
const realSessionUiPackage = JSON.parse(readFileSync(join(root, "packages", "session-ui", "package.json"), "utf8"));
const realPackageLock = JSON.parse(readFileSync(join(root, "package-lock.json"), "utf8"));
const realLauncherPackage = JSON.parse(readFileSync(join(root, "apps", "launcher", "package.json"), "utf8"));
const realLauncherCargo = readFileSync(join(root, "apps", "launcher", "src-tauri", "Cargo.toml"), "utf8");

function runWithMetadata({
	piLock = validRealLock,
	cliPackage = realCliPackage,
	sessionUiPackage = realSessionUiPackage,
	packageLock = realPackageLock,
	launcherPackage = realLauncherPackage,
	launcherCargo = realLauncherCargo,
	rootReadme,
	cliReadme,
} = {}) {
	const dir = mkdtempSync(join(tmpdir(), "pi-metadata-fixture-"));
	try {
		const paths = {
			piLock: join(dir, "pi.lock.json"),
			cliPackage: join(dir, "cli-package.json"),
			sessionUiPackage: join(dir, "session-ui-package.json"),
			packageLock: join(dir, "package-lock.json"),
			launcherPackage: join(dir, "launcher-package.json"),
		};
		for (const [name, path] of Object.entries(paths)) {
			const value = { piLock, cliPackage, sessionUiPackage, packageLock, launcherPackage }[name];
			writeFileSync(path, JSON.stringify(value, null, 2));
		}
		const env = {
			...process.env,
			JOUZU_PI_LOCK: paths.piLock,
			JOUZU_CLI_PACKAGE: paths.cliPackage,
			JOUZU_SESSION_UI_PACKAGE: paths.sessionUiPackage,
			JOUZU_PACKAGE_LOCK: paths.packageLock,
			JOUZU_LAUNCHER_PACKAGE: paths.launcherPackage,
			JOUZU_LAUNCHER_CARGO: join(dir, "Cargo.toml"),
		};
		writeFileSync(env.JOUZU_LAUNCHER_CARGO, launcherCargo);
		const rootReadmePath = join(dir, "root-readme.md");
		writeFileSync(rootReadmePath, rootReadme ?? readFileSync(join(root, "README.md"), "utf8"));
		env.JOUZU_ROOT_README = rootReadmePath;
		const cliReadmePath = join(dir, "cli-readme.md");
		writeFileSync(cliReadmePath, cliReadme ?? readFileSync(join(root, "packages", "cli", "README.md"), "utf8"));
		env.JOUZU_CLI_README = cliReadmePath;
		return spawnSync(process.execPath, [script], {
			encoding: "utf8",
			env,
		});
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}
}

test("a pending-qualification Pi lock fails release metadata validation", () => {
	const pending = { ...validRealLock, reviewedAt: null, compatibilityStatus: "pending-qualification" };
	const result = runWithMetadata({ piLock: pending });
	assert.notEqual(result.status, 0, "pending lock must fail release metadata");
	assert.match(result.stderr, /must be qualified for publication/);
});

test("a launcher version that differs from the Jouzu version fails release metadata validation", () => {
	assert.equal(runWithMetadata().status, 0);
	const fixtures = [
		["package.json", { launcherPackage: { ...realLauncherPackage, version: "0.3.7" } }],
		["Cargo.toml", { launcherCargo: realLauncherCargo.replace(/^version = ".*"$/m, 'version = "0.3.7"') }],
	];
	for (const [label, fixture] of fixtures) {
		const result = runWithMetadata(fixture);
		assert.notEqual(result.status, 0, `${label} must fail release metadata`);
		assert.match(result.stderr, /launcher version differs from the npm Jouzu version/);
	}
});

test("malformed qualified Pi locks fail release metadata validation", () => {
	const fixtures = [
		["non-ISO reviewedAt", { ...validRealLock, reviewedAt: "1" }],
		["unknown top-level field", { ...validRealLock, unexpected: true }],
		[
			"unknown package record field",
			{
				...validRealLock,
				packages: {
					...realLock.packages,
					"@earendil-works/pi-coding-agent": {
						...realLock.packages["@earendil-works/pi-coding-agent"],
						unexpected: true,
					},
				},
			},
		],
		["malformed deviation", { ...validRealLock, deviations: [{}] }],
		["unsafe deviation path", { ...validRealLock, deviations: [{ path: "../pi.patch", sha256: "a".repeat(64) }] }],
	];
	for (const [label, fixture] of fixtures) {
		const result = runWithMetadata({ piLock: fixture });
		assert.notEqual(result.status, 0, `${label} must fail release metadata`);
	}
});

test("Pi package tuple manifest drift fails release metadata validation", () => {
	const fixtures = [
		{
			cliPackage: {
				...realCliPackage,
				dependencies: { ...realCliPackage.dependencies, "@earendil-works/pi-tui": "0.0.0" },
			},
		},
		{
			cliPackage: {
				...realCliPackage,
				dependencies: { ...realCliPackage.dependencies, "@earendil-works/pi-server": "0.0.0" },
			},
		},
		{
			sessionUiPackage: {
				...realSessionUiPackage,
				peerDependencies: {
					...realSessionUiPackage.peerDependencies,
					"@earendil-works/pi-coding-agent": "0.0.0",
				},
			},
		},
		{
			packageLock: {
				...realPackageLock,
				packages: {
					...realPackageLock.packages,
					"node_modules/@earendil-works/pi-tui": {
						...realPackageLock.packages["node_modules/@earendil-works/pi-tui"],
						version: "0.0.0",
					},
				},
			},
		},
	];
	for (const fixture of fixtures) {
		const result = runWithMetadata(fixture);
		assert.notEqual(result.status, 0, "Pi package tuple drift must fail release metadata");
	}
});

test("a qualified Pi lock passes release metadata validation", () => {
	const result = runWithMetadata({
		piLock: validRealLock,
	});
	assert.equal(result.status, 0, result.stderr || result.stdout);
	assert.ok(result.stdout.includes(`release metadata: jouzu@${realCliPackage.version}, Pi `));
});

test("a divergent npm README fails release metadata validation", () => {
	const result = runWithMetadata({
		cliReadme: "# Jouzu\n\nA condensed npm README that no longer matches the root README.\n",
	});
	assert.notEqual(result.status, 0, "divergent package README must fail release metadata");
	assert.match(result.stderr, /packages\/cli\/README\.md differs from the root README\.md/u);
});

test("identical root and npm READMEs pass release metadata validation", () => {
	const readme = readFileSync(join(root, "README.md"), "utf8");
	const result = runWithMetadata({ rootReadme: readme, cliReadme: readme });
	assert.equal(result.status, 0, result.stderr || result.stdout);
});

test("the npm publish workflow stays a bounded transport gate", () => {
	const workflow = readFileSync(join(root, ".github", "workflows", "publish-npm.yml"), "utf8");
	assert.match(workflow, /timeout-minutes: 15/u);
	assert.match(workflow, /environment: npm-publish/u);
	assert.match(workflow, /id-token: write/u);
	assert.match(workflow, /actions\/download-artifact/u);
	assert.match(workflow, /ci-run-id:/u);
	assert.match(workflow, /ci-run-attempt:/u);
	assert.doesNotMatch(workflow, /npm run build|npm ci|npm run pack:check/u);
	assert.match(workflow, /node scripts\/publish-npm\.mjs/u);
	assert.doesNotMatch(workflow, /npm run release:check/u);
	assert.doesNotMatch(workflow, /test:packed|test:auto-update|test:extensions:online|test:live/u);
	assert.doesNotMatch(workflow, /NPM_TOKEN|NODE_AUTH_TOKEN|npm login|npm trust/u);
});

test("CI packs once and shares exact artifacts with parallel native gates", () => {
	const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
	assert.equal(workflow.match(/npm run pack:prepare:ci/gu)?.length, 1);
	assert.match(workflow, /release-artifacts:/u);
	assert.match(workflow, /packed-install:[\s\S]*needs: release-artifacts/u);
	assert.match(workflow, /automatic-update:[\s\S]*needs: release-artifacts/u);
	for (const scope of ["local", "npm-exec", "global"])
		assert.match(workflow, new RegExp(`JOUZU_PACKED_SCOPE: ${scope}\\n`, "u"));
	assert.match(workflow, /JOUZU_PACKED_TARBALL: dist\/ci-artifacts\/candidate\.tgz/u);
	for (const scope of ["success", "rollback"])
		assert.match(workflow, new RegExp(`JOUZU_UPDATE_SCOPE: ${scope}\\n`, "u"));
	assert.match(workflow, /JOUZU_UPDATE_CURRENT_TARBALL: dist\/ci-artifacts\/candidate\.tgz/u);
	assert.match(workflow, /JOUZU_UPDATE_NEXT_TARBALL: dist\/ci-artifacts\/next\.tgz/u);
	assert.match(workflow, /JOUZU_UPDATE_BROKEN_TARBALL: dist\/ci-artifacts\/broken\.tgz/u);
	// Linux and macOS test Node 22; Windows runs add Node 24, the runtime the launcher bundles.
	assert.match(workflow, /node: \$\{\{ fromJSON\(inputs\.platform == 'windows' && '\[22, 24\]' \|\| '\[22\]'\) \}\}/u);
	assert.match(workflow, /published-upgrade:[\s\S]*needs: release-artifacts/u);
	assert.match(workflow, /retention-days: 30/u);
	assert.match(workflow, /release-manifest\.json/u);
});

test("CI qualification matrices stay on hosted Linux and macOS with Windows as manual diagnostics", () => {
	const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
	assert.doesNotMatch(workflow, /\["ubuntu-latest","macos-latest","windows-latest"\]/u);
	assert.equal(
		workflow.match(
			/inputs\.platform == 'windows' && '\["windows-latest"\]' \|\| '\["ubuntu-latest","macos-latest"\]'/gu,
		)?.length,
		4,
		"every package consumer matrix must run ubuntu-latest and macos-latest only",
	);
	// The node and python matrices add the required tier to the same platform choice.
	assert.equal(
		workflow.match(
			/inputs\.platform == 'windows' && '\["windows-latest"\]' \|\| \(github\.event_name != 'workflow_dispatch' && needs\.changes\.outputs\.full != 'true'\) && '\["ubuntu-latest"\]' \|\| '\["ubuntu-latest","macos-latest"\]'/gu,
		)?.length,
		2,
	);
	assert.match(workflow, /options: \[windows, all\]/u);
	assert.match(workflow, /default: windows/u);
	assert.match(
		workflow,
		/legacy-linux-static-fetch:\n {4}needs: changes\n {4}if: \$\{\{[^\n]*inputs\.platform != 'windows' \}\}/u,
	);
});

test("pushes and pull requests run the required tier unless a change needs full qualification, and ci-result covers every job", () => {
	const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
	assert.match(workflow, /changes:\n[^\n]*\n[^\n]*\n {4}if: github\.event_name != 'workflow_dispatch'/u);
	// A push without a complete changed-file list falls back to full qualification.
	assert.match(workflow, /compare\/\$BEFORE\.\.\.\$SHA/u);
	assert.match(workflow, /LABELS=full-ci/u);
	assert.match(workflow, /node scripts\/ci-changes\.mjs/u);
	assert.match(
		workflow,
		/release-artifacts:\n[^\n]*\n {4}needs: changes\n {4}if: \$\{\{ !cancelled\(\) && needs\.changes\.result != 'failure' && \(github\.event_name == 'workflow_dispatch' \|\| needs\.changes\.outputs\.full == 'true'\) \}\}/u,
	);
	assert.equal(
		workflow.match(
			/needs: release-artifacts\n {4}if: \$\{\{ !cancelled\(\) && needs\.release-artifacts\.result == 'success' \}\}/gu,
		)?.length,
		4,
	);
	const jobs = [...workflow.slice(workflow.indexOf("\njobs:\n")).matchAll(/^ {2}([a-z][a-z0-9-]*):\s*$/gmu)]
		.map((match) => match[1])
		.filter((job) => job !== "ci-result");
	const result = workflow.slice(workflow.indexOf("  ci-result:"));
	assert.match(result, /if: always\(\)/u);
	for (const job of jobs) assert.match(result, new RegExp(`\\b${job},`, "u"), `ci-result must need ${job}`);
});

test("CI cancels superseded pull request runs but never another commit's qualification", () => {
	const workflow = readFileSync(join(root, ".github", "workflows", "ci.yml"), "utf8");
	assert.match(
		workflow,
		/group: ci-\$\{\{ github\.ref \}\}-\$\{\{ github\.event_name == 'pull_request' && 'pr' \|\| github\.sha \}\}/u,
	);
	assert.match(workflow, /cancel-in-progress: \$\{\{ github\.event_name == 'pull_request' \}\}/u);
	assert.doesNotMatch(workflow, /cancel-in-progress: true/u);
});

test("the npm publish workflow passes the recipe signing key to the called workflow", () => {
	const workflow = readFileSync(join(root, ".github", "workflows", "publish-npm.yml"), "utf8");
	const recipe = readFileSync(join(root, ".github", "workflows", "launcher-recipe.yml"), "utf8");
	// A called workflow does not inherit secrets. The key lives in the launcher-publish
	// environment that the called job declares, and a secret can be passed by name even
	// when it only exists in that environment, so the caller must name it explicitly.
	assert.match(workflow, /windows-update:[\s\S]*uses: \.\/\.github\/workflows\/launcher-recipe\.yml/u);
	assert.match(
		workflow,
		/windows-update:[\s\S]*secrets:\n\s+JOUZU_RECIPE_PRIVATE_KEY: \$\{\{ secrets\.JOUZU_RECIPE_PRIVATE_KEY \}\}/u,
	);
	assert.match(recipe, /environment: launcher-publish/u);
	assert.match(recipe, /workflow_call:[\s\S]*secrets:\n\s+JOUZU_RECIPE_PRIVATE_KEY:\n\s+required: true/u);
});

test("the npm publish workflow builds and signs the launcher automatically", () => {
	const workflow = readFileSync(join(root, ".github", "workflows", "publish-npm.yml"), "utf8");
	const launcher = readFileSync(join(root, ".github", "workflows", "launcher-runtime.yml"), "utf8");
	// The launcher build is chained to the recipe so every release produces a signed
	// installer for local acceptance without a manual dispatch, and it reuses the runtime
	// the recipe job in the same run uploaded.
	assert.match(workflow, /windows-launcher:[\s\S]*needs: windows-update/u);
	assert.match(workflow, /windows-launcher:[\s\S]*uses: \.\/\.github\/workflows\/launcher-runtime\.yml/u);
	assert.match(
		workflow,
		/windows-launcher:[\s\S]*secrets:\n\s+TAURI_SIGNING_PRIVATE_KEY: \$\{\{ secrets\.TAURI_SIGNING_PRIVATE_KEY \}\}/u,
	);
	assert.match(workflow, /windows-launcher:[\s\S]*runtime_run_id: \$\{\{ github\.run_id \}\}/u);
	// The installer publishes automatically onto the release page.
	assert.match(workflow, /windows-launcher:[\s\S]*publish: true/u);
	assert.match(launcher, /workflow_call:[\s\S]*secrets:\n\s+TAURI_SIGNING_PRIVATE_KEY:\n\s+required: true/u);
	assert.match(launcher, /name: Reuse the runtime this run produced/u);
	assert.match(launcher, /name: Verify the restored runtime/u);
	// A publication dispatch sources its runtime from the run whose recipe job produced it.
	assert.match(
		launcher,
		/node packaging\/launcher\/runtime-source\.mjs\n\s+if \(\$LASTEXITCODE\) \{ exit \$LASTEXITCODE \}/u,
	);
	const validator = readFileSync(join(root, "packaging", "launcher", "runtime-source.mjs"), "utf8");
	assert.match(validator, /\.github\/workflows\/publish-npm\.yml/u);
	assert.match(validator, /windows-update \/ recipe/u);
});

test("windows artifacts are named for the Jouzu release and land on it", () => {
	const finalize = readFileSync(join(root, "packaging", "launcher", "finalize-windows-bundle.ps1"), "utf8");
	const publish = readFileSync(join(root, "packaging", "launcher", "publish-launcher.ps1"), "utf8");
	// A user downloading from the release page looks for the Jouzu version, so both artifacts are
	// named from the release they install.
	assert.match(finalize, /\$assetPrefix = "jouzu-win-x64-v\$JouzuVersion"/u);
	assert.match(finalize, /\$fullSetup = Join-Path \$output "\$assetPrefix-setup\.exe"/u);
	assert.match(finalize, /\$updateSetup = Join-Path \$output "\$assetPrefix-update\.exe"/u);
	assert.match(finalize, /jouzuVersion=\$JouzuVersion;launcherVersion=\$Version/u);
	// They belong on the version release beside the npm package, and stay replaceable so a broken
	// installer is repaired by re-running the workflow.
	assert.match(publish, /\$tag = "v\$JouzuVersion"/u);
	assert.match(publish, /gh release upload \$tag[\s\S]*--clobber/u);
	// The artifacts land on the Jouzu release; no separate launcher release is created.
	assert.doesNotMatch(publish, /launcher-v\$/u);
	assert.doesNotMatch(publish, /release create \$tag/u);
	// The launcher carries the Jouzu version: the bundle refuses another version, and the feed
	// offers the release's version with its Jouzu changelog section.
	assert.match(finalize, /if \(\$Version -ne \$JouzuVersion\) \{ throw/u);
	assert.match(publish, /version=\$JouzuVersion/u);
	assert.match(publish, /launcher-notes\.mjs" \(Join-Path \$PSScriptRoot '\.\.\/\.\.\/CHANGELOG\.md'\)/u);
});

test("publish accepts the Linux/macOS candidate before post-publication Windows installer qualification", () => {
	const workflow = readFileSync(join(root, ".github", "workflows", "publish-npm.yml"), "utf8");
	assert.match(
		workflow,
		/windows-evidence:\n\s+description: Native Windows qualification JSON when available; installer qualification may follow npm publication\n\s+required: false\n\s+default: ''\n\s+type: string/u,
	);
	assert.match(workflow, /WINDOWS_QUALIFICATION_JSON: \$\{\{ inputs\.windows-evidence \}\}/u);
	assert.match(workflow, /if \[\[ -n "\$WINDOWS_QUALIFICATION_JSON" \]\]; then/u);
	assert.match(workflow, /dist\/ci-artifacts\/windows-qualification\.json/u);
	const publisher = readFileSync(join(root, "scripts", "publish-npm.mjs"), "utf8");
	assert.match(publisher, /import \{[^}]*verifyWindowsQualification[^}]*\} from "\.\/release-artifact\.mjs";/u);
	assert.match(publisher, /if \(existsSync\(join\(directory, "windows-qualification\.json"\)\)\)/u);
	assert.match(
		publisher,
		/verifyWindowsQualification\(JSON\.parse\(readFileSync\(join\(directory, "windows-qualification\.json"\), "utf8"\)\), manifest\)/u,
	);
	assert.ok(
		publisher.indexOf('npm", [') < publisher.indexOf("verifyWindowsQualification("),
		"optional Windows qualification must be checked before npm publish when supplied",
	);
});
