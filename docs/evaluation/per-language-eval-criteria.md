# Per-language model and artifact evaluation criteria

`scripts/live-locale-smoke.mjs` checks one model's response-language and artifact
handling in a temporary session. These are automated smoke-test criteria, not
language-quality scores or product qualification. Keep the criteria and prompt
version fixed when comparing runs.

## Scope

One run per language: `en`, `ja`, `zh-Hans`, `zh-Hant`. One run measures all six
dimensions in a single session, so the six results share one model, one route,
one prompt, and one cost budget. Chinese response-language checks do not make
the Chinese draft UI catalogs available.

## Opt-in and budget

A run is opt-in and spends real provider credit. It stays out of the
deterministic test gate.

| Variable | Required | Value |
| --- | --- | --- |
| `JOUZU_LIVE_SMOKE` | yes | must be `1` |
| `JOUZU_LIVE_PROVIDER` | yes | provider id |
| `JOUZU_LIVE_MODEL` | yes | model id |
| `JOUZU_LIVE_MAX_USD` | yes | greater than 0 and no greater than 0.25 |
| `JOUZU_LIVE_LOCALE` | no | one of `en`, `ja`, `zh-Hans`, `zh-Hant`; defaults to `ja` |
| `JOUZU_LIVE_ROUTE` | no | free-text route label recorded as-is; defaults to the provider id |

The run fails when the reported cost of any assistant response is missing, or
when the summed cost exceeds the declared budget. The budget is checked after
each response; it does not cap in-flight spending.

## The six dimensions

Each dimension grades one observable from the run. The run writes its files in a
temporary working directory that carries no repository or conversation content.

| Dimension | Observable | Pass criterion |
| --- | --- | --- |
| Comprehension | `answer.txt` | The file reads `true` (case-insensitive, an optional trailing period allowed), answering a true statement written in the target language. |
| Fluency | `explanation.txt` | Non-empty; contains target-script characters (`ja`: hiragana or katakana; `zh-Hans`/`zh-Hant`: Han; `en`: Latin letters); and, for the CJK languages, Latin letters are less than half of the characters, so a pure English answer fails. |
| Coding | `sum.py` | Contains a `sum_list` function definition, a `return`, and a `sum(` call. |
| Tool use | session events | At least one successful `write` tool end and one successful `read` tool end. |
| Mixed-language retention | `notes.md` | Contains the exact line `API_KEY=abc123` and at least one non-empty line with target-script characters. |
| Artifact-policy compliance | `kept.txt`, `translated.txt` | Both artifact cases below pass. |

The target-language content used by a run is defined in
`scripts/live-locale-smoke.mjs` under `LOCALES`. Inspect the prompt before a
paid run. Automated grading does not establish that the prompt wording or the
model's answer is linguistically correct.

## Artifact-policy compliance

The check covers both directions and confirms that nothing is translated unless
asked.

- **No translation requested.** The run sets the artifact policy to `preserve`
  for comments, documentation, commits, and reviews, and asks for `kept.txt`
  whose entire content is exactly `Hello, world.`. Pass requires the file bytes
  to equal `Hello, world.` with no trailing newline. Any translation, reflow, or
  added newline fails.
- **Explicit translation requested.** The run asks for the English text
  `Hello, world.` to be translated into the target language, written to
  `translated.txt`. For `en`, the source is the French text `Bonjour le monde.`
  so the case is not a no-op. Pass requires a non-empty result that differs from
  the source and contains target-script characters.

## Reproducibility conditions

The run report includes the following conditions. Retain them when comparing
results, but remove private provider routes and identifying data before sharing.

- Model id.
- Provider id and route label.
- Node.js version.
- Jouzu version, read from the packed CLI package.
- Packed-artifact integrity (`sha512-...`), so the evaluated bytes are named.
- Prompt digest: the SHA-256 of the composed prompt.
- Run date (ISO 8601).

## Automated grading limits

The graders are deterministic checks over files and session events. They measure
observable behavior, not linguistic quality.

- Fluency is a script-and-fallback heuristic. A fluent answer that borrows Latin
  terms, or a clumsy answer written entirely in the target script, can pass or
  fail against the heuristic. Human fluency review is a separate measurement.
- Comprehension checks one true statement per language. It is a spot check, not
  a comprehension score.
- The coding check matches source text; it does not execute Python. A correct
  implementation that sums with a loop fails the required `sum(` pattern.
- The English mixed-language check can match Latin letters in the identifier
  line itself; it does not independently prove the second line is English.
- The artifact cases check two files. They confirm the boundary for those files,
  not every artifact the model could create.
- The run does not deliberately exercise compaction, tool retries, or streaming
  interruption. Those are recorded as confounders when they appear.

A dimension that a run does not reach is recorded as **not measured**, with the
reason. A missing dimension is never counted as a pass.
