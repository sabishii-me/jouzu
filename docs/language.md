# Language, locale and prompt instructions

This guide describes how Jouzu's interface language, model instructions, profiles and child-agent preferences fit together. For file locations, see [Configuration](configuration.md#language). For which interface surfaces are translated, see [Localization coverage](localization.md).

## Independent controls

| Layer | Controls | Does not control |
| --- | --- | --- |
| Jouzu identity and shared guidance | The default coding-assistant identity, editing and verification rules, tool routing and workflow instructions | UI locale, provider, model or region |
| Model-specific guidance | Additional instructions for a matching selected model, such as Astra | Language selection or model access |
| UI locale (`uiLocale`) | Jouzu's catalog-backed labels, menus and diagnostics | Model replies, source text or artifact language |
| Response language (`responseLanguage`) | User-facing model explanations and results | Interface text or automatic translation of project files |
| Artifact policy (`artifactPolicy`) | Language of requested comments, documentation, commits and reviews, separately | Conversation language, model or provider |
| Profile (`core` or `ja`) | Installed instructions, skills and prompt templates | UI locale or model/provider selection |
| Custom system prompt | User-owned replacement for the default identity and guidance | Disabling every extension, resource or appended instruction |
| Project/task instructions | Requirements for the work, including requested language and exact text | Automatically saving a UI or language preference |

These controls can be combined. Choosing Japanese UI does not select the JA profile. Asking for a Japanese reply does not authorize translating files, changing the UI, or saving settings.

## UI locale

The interface offers English (`en`) and Japanese (`ja`, preview). `auto` resolves a locale from the environment. The accepted Chinese locale tags, `zh-Hans` and `zh-Hant`, use the English UI fallback; they are valid response-language preferences, not offered Chinese interfaces.

For one launch:

```sh
jz --jouzu-ui-locale ja
```

Startup precedence, highest first:

1. `--jouzu-ui-locale`.
2. `JOUZU_UI_LOCALE`.
3. Saved `uiLocale`.
4. For `auto`, the first nonempty `LC_ALL`, `LC_MESSAGES` or `LANG`.
5. English fallback if no offered locale matches.

The locale environment does not select response or artifact languages. UI preview affects the Settings panel immediately; restart to use a saved UI change throughout the session. Pi-owned screens, third-party extensions and service-owned web pages have their own language boundaries.

## Response language and artifacts

`responseLanguage` accepts `auto`, `en`, `ja`, `zh-Hans` or `zh-Hant`. The default `auto` adds no fixed conversational-language instruction; it does not mean “use the UI locale.” A fixed preference adds an instruction such as `Response language: Japanese (ja)`. The instruction itself may be written in English; the requested answer language is Japanese.

Artifact language is independent. Each field accepts `preserve`, `project` or one of the four fixed language tags:

| Field | Built-in default |
| --- | --- |
| `comments` | `preserve` |
| `documentation` | `project` |
| `commits` | `project` |
| `reviews` | `project` |

`preserve` keeps existing text in its existing language. `project` follows the project's existing language. An explicit language applies to requested work; it is not a request to translate existing files. Commands, identifiers, paths, code, quotes and source errors remain exact.

Settings offers artifact presets: the built-in defaults, or one language choice applied to all four fields. For a mixed policy such as Japanese documentation and English commits, edit the individual fields in `localization.json` and start a new session.

Fresh sessions resolve response language from the saved preference, then `auto`. Artifact fields resolve individually from saved preferences, then the defaults above. Within a running session, applied session preferences take precedence. The CLI does not trust a repository's `.jouzu/localization.json` as an automatic artifact-policy source; use Settings or the user configuration file. Ordinary repository and task instructions still describe the work to perform.

A conversational request for another language is an instruction to the model, not a settings write. To change the configured default reliably, use the response-language control. Model compliance and translation quality are not guaranteed by prompt delivery.

## Save or apply to this session

Open `/catalogs`, select **View → Language**, and change the desired fields. Arrow-key preview does not save. Press `Enter` to review and confirm the changes. To make an already-active session override permanent, focus its row, press `Enter`, choose **Saved setting**, and confirm; you do not need to change the language first.

| Scope | Storage | Future sessions |
| --- | --- | --- |
| Session | Overrides keyed to the current session | Does not establish a new default |
| Saved setting (environment scope) | Requested preferences in `localization.json` | New sessions use the saved values |

Saved scope persists response language and artifact preferences as well as UI locale. Unchanged preferences are retained. Applying a response/artifact change affects the current agent on its next turn, not a reply already in progress. Other running sessions are not silently reconfigured. A CLI or environment UI override can still mask the saved UI preference.

Direct edits to `localization.json` take effect in a new session; they do not send an apply event to a running agent. Preserve unrelated fields and do not replace an unreadable or malformed file with an example. Version 1 settings remain readable; absent response/artifact fields resolve to defaults.

The Language reset operation clears this session's overrides and resets the saved UI preference to `auto`. It retains saved response/artifact preferences, which become effective again after the session overrides are removed; it is not an erase-all-language-settings action.

Settings and session overrides are separate files. If updating the session file fails after a save, Jouzu attempts to restore the previous settings without overwriting a newer save. This is recovery, not a crash-safe two-file transaction. If recovery cannot complete, the panel reports it; reopen Language settings and inspect the saved values before retrying.

## Profiles: Core and JA

`core` provides the shared instructions, five bundled Jouzu skills and the review prompt template. It does not choose a response language.

`ja` extends Core: it inherits those assets unchanged and installs a Japanese-first `APPEND_SYSTEM.md`. With normal append-file discovery, that policy requests concise Japanese explanations, preserves technical text, follows task/project artifact rules and yields when the user requests another language. Custom append sources can replace it, as described below. There is no separate Japanese copy of the shared runtime guidance to keep in sync.

First-run onboarding uses Core and asks for interface and response languages separately. For independent language controls, prefer Core plus the desired response setting. An explicitly selected JA profile adds a Japanese instruction even when `responseLanguage` is `auto`; `auto` does not remove profile instructions.

Examples:

| Profile | UI locale | Response language | Result |
| --- | --- | --- | --- |
| Core | `ja` | `auto` | Japanese UI; no fixed conversational-language directive |
| Core | `en` | `ja` | English UI; Japanese response directive |
| Core | `ja` | `en` | Japanese UI; English response directive |
| JA | `en` | `auto` | English UI; Japanese-first profile instruction |
| Core | `ja` | `ja`, commits `en` | Japanese UI and explanations; requested commit messages in English |

An explicit JA profile and an explicit non-Japanese response preference put both instruction layers in the prompt. Use Core to avoid that combination when settings should be the only language authority.

Profile selection uses `--jouzu-profile`, `JOUZU_PROFILE` or the saved profile choice; see [Profiles](profiles.md). `jz profile-migration plan` previews converting a saved profile-based language choice into language settings. Inspect the plan before applying it: user-edited append instructions are preserved, not silently removed. Migration has an explicit apply and rollback path; it is not required for ordinary Settings changes.

## Identity, guidance and custom prompts

The default identity is the same Jouzu coding assistant in either interface language. Shared guidance covers editing, evidence, verification, tools, skills and workflow. Capability routing depends on available tools/skills; model-specific guidance depends on the selected model. Response and artifact instructions are composed separately from those shared rules.

Jouzu supplies its default identity, shared guidance, routing and applicable model/language instructions in Pi's `preamble` section. Tool rules, documentation pointers, date, project context, skills and append-system content occupy other sections. Workflow can add role and subagent instructions.

A user-provided custom system prompt, such as an agent-directory `SYSTEM.md`, prevents Jouzu from installing its default preamble, model/language guidance and date/docs replacements. Selecting Japanese responses does not rewrite that custom prompt. The user must put the intended language behavior into it. Pi may still attach skills, project context and `APPEND_SYSTEM.md`; workflow and flow extensions may still supply instructions. A custom prompt is not a switch that disables all extensions.

A profile's append file adds instructions; it does not replace the default identity. The normal parent resource loader selects prompt sources in this order:

| Prompt | Highest-priority source first |
| --- | --- |
| Replacement | Explicit `--system-prompt` input, trusted project `.pi/SYSTEM.md`, agent-directory `SYSTEM.md`, built-in prompt |
| Append | Explicit `--append-system-prompt` inputs, trusted project `.pi/APPEND_SYSTEM.md`, agent-directory `APPEND_SYSTEM.md` |

Explicit inputs may be text or a file path. File discovery selects one append file; it does not merge project and agent-directory append files. Thus a trusted project append file can replace the installed JA append policy. Untrusted project prompt files are not loaded by this discovery path. Profile asset updates also preserve user-modified files through the conflict handling described in [Profiles](profiles.md).

Selecting a UI locale does not translate the system prompt or change an agent role. Editing prompts or choosing a response language does not select a different model, provider, region or privacy policy.

## Child agents

Each launch or explicit resume takes a snapshot of the calling agent's active language preferences. A staged Settings change is not used until applied. Running or queued children retain the snapshot they already received.

Ordinary children inherit the caller's fixed response language for explanations and returned results. If the caller has no fixed preference and uses the built-in JA profile, the profile supplies Japanese as the fallback. An explicit response preference wins over that fallback; UI locale is never used to infer it. Without a fixed preference or profile default, the child follows the assignment's language.

Artifact-producing children inherit the caller's resolved per-field artifact policy. A Japanese reply preference alone does not make comments or commits Japanese. Preservation-only and structured-output roles retain their restrictions: inheritance does not authorize translating history, quotes or source material, or replacing required structured output with prose. Exact technical text stays exact.

Children inherit the configured language contract, not an inferred preference from arbitrary earlier conversation or custom prompt text. They do not inherit the parent's custom system prompt. A parent with a custom English-only prompt and configured Japanese response preference can therefore launch a Japanese child, even though the parent's custom prompt suppresses its own Japanese instruction. Set compatible configured preferences and include one-off task-language requirements explicitly in the assignment.

Child runs use the resolved role contract instead of appending a second JA profile policy. A resumed child receives the caller's current active configured preferences while retaining its conversation/context history; that history is not translated.

## When instructions change and what caching means

Ordinary user messages, replies and tool results extend history without inherently changing the system instructions. Date rollover, a model or language change, tool activation, role changes or resource reloads can change sections. Response-language changes update the preamble on the next applicable turn; a date change has its own section.

Pi can keep the leading system message stable and send later updates only when the route supports mid-conversation system messages. Otherwise, it folds updates into the leading message. Tool declarations and provider cache policies also affect reuse. Named sections do not guarantee cache hits, lower latency or lower charges.

## Diagnose a mismatch

Run `jz doctor` or `jz doctor --json` to inspect resolved startup values, their sources, the profile and catalog fallback. A separate doctor process reports saved/startup resolution; it is not the running session's live override state.

- Japanese menus but English replies: check response language, not only UI locale.
- Japanese replies with response `auto`: check the JA profile and append/custom instructions.
- Saved UI choice appears ignored: check CLI/environment overrides and restart.
- Files use a different language from replies: inspect the artifact policy and project/task instructions.
- A running child keeps an earlier language: its launch snapshot is intentional; use an explicit resume or a new child for the updated preference.
- A custom prompt ignores response settings: it owns the preamble; update its instructions deliberately.

For exact paths and the JSON example, see [Configuration](configuration.md#language). For catalog coverage and residual English, see [Localization](localization.md).
