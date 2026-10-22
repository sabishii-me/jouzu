# Japanese localization review

Review the Japanese wording and the working terminal interface from the same source revision. You can browse every catalog message without building Jouzu, then use the isolated build below to test the interface.

**This is a language and usability review, not release approval.** Record untranslated text, misleading wording, layout problems, and untested environments. Keep “checked with no issue” separate from “not tested.”

## 1. Review target

| Item | Target |
| --- | --- |
| Repository and branch | [`shisa-ai/jouzu`, `jouzu-ja`](https://github.com/shisa-ai/jouzu/tree/jouzu-ja) |
| Exact source revision | Recorded in the [inventory manifest](review/ja-localization/manifest.json) and enforced by the build helper |
| Product base | Jouzu 0.2.1 with Pi 1.4.0 |
| Scope | Jouzu-owned Japanese interface text, language settings, protected technical values, and terminal layout |
| Interface languages | English and Japanese; Chinese catalogs are drafts and are not offered as CLI interface languages |

Keep one source revision throughout your review. If you test another revision, submit its results separately. A successful review does not automatically apply to a different commit.

## 2. Browse all strings and localization sources

| File | Use |
| --- | --- |
| [Inventory and source index](review/ja-localization/README.md) | Coverage, counts, noncatalog text, and links to original source |
| [Side-by-side HTML](review/ja-localization/catalogs.html) | Download and open locally to compare English, Japanese, and the Chinese drafts |
| [UTF-8 CSV](review/ja-localization/catalogs.csv) | Assign ranges to reviewers or add feedback columns in a spreadsheet |
| [Source manifest](review/ja-localization/manifest.json) | Exact commit, file hashes, and exported coverage |
| [Localization glossary](docs/localization-glossary.md) | Shared terminology and technical names that must remain unchanged |
| [Localization behavior](docs/localization.md) | Language settings, fallback behavior, and English text owned by upstream components |

The inventory covers all message IDs in the source catalogs. Check multiline text, selection branches, variables, and comments against the original files. The index also includes launcher and installer text, profiles, language instructions, and the direct-string allowlist: the recorded exceptions for text that is not in a catalog.

**Catalog counts are not a product-wide translation percentage.** The index distinguishes catalog rows from other source files. Model-generated answers, external service pages, and text supplied by third-party extensions are not all enumerated by a static catalog export. Report any English you encounter and identify its screen or source when possible.

GitHub does not render the HTML comparison as a web page. Download the raw file, or clone the repository and open it locally. Import CSV cells as text, not formulas or numbers. Leave the source columns unchanged and put suggestions in separate columns or the feedback template below.

### Wording checklist

- Does the Japanese preserve the English meaning, negation, conditions, scope, amounts, and deadlines?
- Is it natural Japanese, without unnecessary formality, machine-translated phrasing, or inconsistent terminology?
- Are the consequences of Apply, Save, Allow, Cancel, Delete, and Sign out distinguishable?
- Does an error explain what to do next without implying that the action succeeded?
- Do authentication, privacy, billing, update, rollback, and deletion messages avoid promises that the behavior does not support?
- Are variables such as `{ $name }` and all selection branches preserved? Commands, paths, URLs, API names, and exact source errors must not be translated.
- When English remains, can you identify whether Jouzu, Pi, an extension, or an external service displays it?

## 3. Build and run the review candidate

### Prerequisites

- Linux, macOS, or Windows Subsystem for Linux (WSL). This helper does not run in native Windows Python.
- Python **3.10 or later**, Git, Bash, Node.js **22.19.0 or later**, npm, and Go **1.21 or later** on `PATH`.
- Network access to download the source, dependencies, and build tools.
- A new review directory outside any Git checkout.

The helper runs the candidate's `dev-build.sh build`. It does not run `npm link`, install globally, or replace your normal `jz` / `jouzu` command.

### Get the instructions and build

```bash
git clone --branch jouzu-ja https://github.com/shisa-ai/jouzu.git jouzu-ja-review-docs
cd jouzu-ja-review-docs
python3 scripts/ja_review.py build --transport https --directory "$HOME/jouzu-ja-review"
```

The helper downloads the exact source commit recorded in this package, not whichever commit happens to be at the branch tip. It creates an isolated source checkout, settings directory, sample project, logs, and `receipt.json` containing the build identity and check outcomes.

The build and startup checks do not send model prompts. Downloads require network access. If the helper refuses an existing directory or mismatched commit, use a new review directory. Do not reset, clean, or reinstall dependencies in your normal development checkout to make the review build work.

### Check and launch

```bash
python3 scripts/ja_review.py check --directory "$HOME/jouzu-ja-review"
python3 scripts/ja_review.py run --directory "$HOME/jouzu-ja-review" -- --version
python3 scripts/ja_review.py run --directory "$HOME/jouzu-ja-review" -- doctor
python3 scripts/ja_review.py run --directory "$HOME/jouzu-ja-review"
```

Use this `run` command instead of your normal `jz` command. It launches from the sample project with separate settings, inherited provider credentials removed, automatic updates disabled, and Japanese saved as the initial interface language. It does not force the interface language on every launch, so you can test saved changes in Settings. Assistant response language starts at Automatic, which adds no fixed conversational-language instruction; artifact-language instructions still apply.

You do not need to submit prompts to inspect the interface and settings. If startup offers to connect to Shisa AI, choose **N** to continue without signing in. For optional model-response testing, explicitly authenticate inside the review environment and choose a model and budget. **Authentication and prompts can contact external services and incur charges.** Disabled automatic updates do not make this a network sandbox. Do not place confidential source code or production data in the sample project.

If a command fails, report the command, exit code, tool versions, and relevant error. Remove tokens, authentication files, personal paths, and private data before sharing evidence. Do not upload the entire review directory: it can contain credentials and session content after you sign in.

The default limits are 30 minutes for the build, 5 minutes per source download, 2 minutes per check, and 2 hours for an interactive session. Use the command's `--timeout` option to select a finite limit; `build` also accepts `--fetch-timeout` and `--check-timeout`. Inspect the named file under `logs/` before retrying. If an interrupted run leaves `.review-lock`, remove only that file and only after confirming its recorded process has stopped. Do not delete the source, settings, or receipt to bypass a failed check.

For a no-color diagnostic:

```bash
NO_COLOR=1 python3 scripts/ja_review.py run --directory "$HOME/jouzu-ja-review" -- doctor
```

## 4. Test the interface

For each row, record **Checked**, **Needs change**, or **Not tested**, plus the operating system, terminal, width, and input method.

| Area | Actions and observations |
| --- | --- |
| Startup and diagnostics | Read the version, `doctor`, and help output. Check that the Japanese is understandable and commands, paths, and hashes are unchanged. |
| Models / Workflow / Settings | Open the Palette with `Ctrl+L` and move between views with `Tab`. Check selection, status, hints, and empty lists. |
| Interface language | In Settings, choose the Language view. Preview Japanese and English, cancel with `Esc`, then test applying a choice and restarting. Distinguish preview from saved state. |
| Response language | Check that this is clearly separate from interface language. Automatic must not imply that replies are fixed to Japanese. |
| Artifact language | Check explanations for comments, documentation, commits, and reviews. Report differences between the displayed policy and observed behavior. |
| Errors and recovery | Read errors for invalid operations or an unconfigured provider. Check whether the next action is clear without completing authentication or deletion. |
| Confirmation and cancellation | Confirm that dialogs identify the target and consequences. Test cancellation with `Esc`; destructive actions do not need to be completed. |
| Narrow terminals | Test widths of 48, 80, and 120 columns. Inspect Japanese, long paths, key hints, and selection markers for clipping, overlap, and awkward breaks. |
| Japanese input | Test composition, conversion confirmation, pasted text, cursor placement, and whether changing settings preserves input. |
| No color and accessibility | Check whether status remains distinguishable without color. Where available, use a screen reader to check punctuation, brackets, backticks, and control labels. |
| Model replies — optional | With an explicitly authenticated model, check prose language, quotations, technical names, and preservation of existing files. Record the model and route separately from interface-translation findings. |

Suggested input: `日本語の確認　全角スペース・ｶﾀｶﾅ・ば・ば・🦁`.

Do not report an existing automated test or someone else's result as a check you performed. WSL results are not native Windows results.

## 5. Limits and priority checks

- **Review coverage:** Japanese catalog metadata reports `stale`: source wording has changed since its recorded review. Every exported row starts as unreviewed for this review. Passing automated checks do not establish expert approval; state the IDs and screens you actually reviewed.
- **English outside Jouzu:** Pi, extensions, and external services can display English. The ownership information in [localization behavior](docs/localization.md) helps classify it; it is not proof that every upstream screen has been tested on this build.
- **Native environments:** Record macOS, native Windows, SSH, Japanese operating-system locales, input-method composition, and screen-reader results individually. A Linux build does not qualify those environments.
- **Artifact policy:** Check the startup behavior as well as the labels. Project-policy loading and combinations of per-artifact settings need particular attention; do not infer enforcement solely from an available setting.
- **Launcher versus CLI:** Launcher strings are included for wording review, but these commands build the terminal application. Reviewing launcher source or screenshots is not the same as running the desktop launcher.
- **Model evaluation:** Automated language checks do not establish natural Japanese or model quality. Keep model findings separate from interface findings.

## 6. Submit findings

Return your annotated file to the review coordinator, or file a [Jouzu issue](https://github.com/shisa-ai/jouzu/issues) for a public-safe finding. Public issues must not contain credentials, private code, personal paths, or confidential review material. Preserve the exact command and message ID when removing sensitive content.

```text
Source commit (from manifest.json or receipt.json):
Reviewer / date:
Reviewed scope (IDs, files, screens):
OS / terminal / columns / Japanese input method / screen reader:

Message ID or source file and line:
Screen and reproduction steps:
English source:
Displayed Japanese:
Problem (meaning / terminology / naturalness / operation / wrapping / accessibility):
Suggested correction:
Impact (could cause a wrong action / blocks understanding / wording improvement):
Screenshot or log excerpt (sensitive content removed):
Result: Checked / Needs change / Not tested
```

One person does not need to review everything. Identify the assigned range and what remains untested. After a correction, recheck both the wording and its behavior in the interface. Record language approval, automated-test results, and the release decision separately.
