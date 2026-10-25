import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import type { ProfileId } from "./args.js";
import { CatalogMessageId, catalogText, defaultCatalog } from "./cli-messages.js";
import type { CatalogBundle } from "./locale-catalog.js";
import { validatePrivateDirectory, writeFilePrivateAtomic } from "./private-fs.js";

const PROFILE_CHOICE_FIELDS = new Set(["schemaVersion", "profile", "chosenAt"]);

/**
 * The catalog IDs for the saved-profile-choice validation messages. A JSON error
 * detail is a protected value passed as an argument.
 */
const PROFILE_CHOICE_MESSAGE_ID = {
	notRegularFile: "jouzu.cli.profile.choice.notRegularFile",
	invalidJson: "jouzu.cli.profile.choice.invalidJson",
	notObject: "jouzu.cli.profile.choice.notObject",
	unknownFields: "jouzu.cli.profile.choice.unknownFields",
	fieldsInvalid: "jouzu.cli.profile.choice.fieldsInvalid",
} as const;

export interface ProfileChoice {
	schemaVersion: 1;
	profile: ProfileId;
	chosenAt: string;
}

export class ProfileChoiceError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ProfileChoiceError";
	}
}

export function readProfileChoice(path: string, catalog: CatalogBundle = defaultCatalog()): ProfileChoice | undefined {
	try {
		validatePrivateDirectory(dirname(path));
	} catch (error) {
		throw new ProfileChoiceError(error instanceof Error ? error.message : String(error));
	}
	if (!existsSync(path)) return undefined;
	const metadata = lstatSync(path);
	if (!metadata.isFile() || metadata.isSymbolicLink()) {
		throw new ProfileChoiceError(catalogText(catalog, PROFILE_CHOICE_MESSAGE_ID.notRegularFile));
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		throw new ProfileChoiceError(
			catalogText(catalog, PROFILE_CHOICE_MESSAGE_ID.invalidJson, {
				detail: error instanceof Error ? error.message : String(error),
			}),
		);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new ProfileChoiceError(catalogText(catalog, PROFILE_CHOICE_MESSAGE_ID.notObject));
	}
	const choice = parsed as Record<string, unknown>;
	if (!Object.keys(choice).every((key) => PROFILE_CHOICE_FIELDS.has(key))) {
		throw new ProfileChoiceError(catalogText(catalog, PROFILE_CHOICE_MESSAGE_ID.unknownFields));
	}
	if (
		choice.schemaVersion !== 1 ||
		(choice.profile !== "core" && choice.profile !== "ja") ||
		typeof choice.chosenAt !== "string" ||
		!Number.isFinite(Date.parse(choice.chosenAt))
	) {
		throw new ProfileChoiceError(catalogText(catalog, PROFILE_CHOICE_MESSAGE_ID.fieldsInvalid));
	}
	return { schemaVersion: 1, profile: choice.profile, chosenAt: choice.chosenAt };
}

export function writeProfileChoice(path: string, profile: ProfileId, now = new Date()): ProfileChoice {
	const choice: ProfileChoice = { schemaVersion: 1, profile, chosenAt: now.toISOString() };
	writeFilePrivateAtomic(path, `${JSON.stringify(choice, null, 2)}\n`);
	return choice;
}

export function parseJapaneseSupportAnswer(answer: string): ProfileId {
	return /^(?:y|yes|はい)$/iu.test(answer.trim()) ? "ja" : "core";
}

export async function promptForJapaneseSupport(
	input: NodeJS.ReadableStream = process.stdin,
	output: NodeJS.WritableStream = process.stdout,
	catalog: CatalogBundle = defaultCatalog(),
): Promise<ProfileId> {
	output.write(
		`${catalogText(catalog, CatalogMessageId.profileChoiceIntro)}\n` +
			`${catalogText(catalog, CatalogMessageId.profileChoiceConflict)}\n`,
	);
	const readline = createInterface({ input, output });
	try {
		// The trailing space separates the prompt from the typed answer and stays
		// in the renderer, because Fluent drops trailing whitespace from a value.
		const answer = await readline.question(`${catalogText(catalog, CatalogMessageId.profileChoiceQuestion)} `);
		return parseJapaneseSupportAnswer(answer);
	} finally {
		readline.close();
	}
}
