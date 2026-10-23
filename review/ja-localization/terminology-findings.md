# Japanese Localization Terminology Findings (`catalogs.csv`)

This is a historical review of source `2884de8`, not a list of unresolved defects in the current candidate. Its recommendations and the accompanying `proposed-changes.csv` record the proposals from that review, not independent language approval. Consult the [current inventory](README.md) and [current glossary](../../docs/localization-glossary.md) for the text and terminology now in use.

Source inventory: [`review/ja-localization/catalogs.csv`](https://github.com/shisa-ai/jouzu/blob/46fa16a84621afaa3226e9b17e30cb93911a0e79/review/ja-localization/catalogs.csv) (1,576 Fluent message entries across `cli.ftl`, `runtime.ftl`, `localization-settings.ftl`, `profile-migration-command.ftl`, and `localization-deferral.ftl`).
Reference glossary: [`docs/localization-glossary.md`](https://github.com/shisa-ai/jouzu/blob/2884de8cee8560810cfc29b235cd08c428469659/docs/localization-glossary.md).

This document lists translations in `catalogs.csv` that violate the repository's protected-value rules, produce ungrammatical or unintelligible Japanese nominalizations, use overly literal calques for internal architecture terms, or collide across distinct product concepts.

---

## Summary Table: Non-Canonical, Odd, or Inconsistent Term Translations

| English Term | Current JA in `catalogs.csv` | Canonical JA (Approved) | Why It Is Odd or Non-Canonical |
| :--- | :--- | :--- | :--- |
| **offering(s)** *(model offerings)* | `提供` (`提供 { $total } 件`, `キャッシュされた提供がありません`) | `提供モデル` | `提供` is the verbal act of providing, not a countable catalog item. `キャッシュされた提供がありません` ("no cached acts of providing") and `モデルの提供は破棄される` are ungrammatical as countable objects. |
| **converged** / **already converged** | `収束済み` / `すでに収束しています` | `適用済み` (`すでに適用済みです`) | `収束` in Japanese is mathematical series convergence or an outbreak subsiding, not config state matching target state (`キーバインド既定はすでに収束しています`). |
| **quarantine / quarantined** | `検疫` (`検疫されました`, `検疫中の候補`) | `隔離` (`隔離されました`, `隔離中の候補`) | `検疫` is medical/border quarantine or antivirus scanning. For holding back a catalog revision that failed validation, standard IT Japanese uses `隔離`. |
| **content fingerprint** | `内容の指紋` | `内容のフィンガープリント` | Cryptographic/hash fingerprints (SSH, TLS, SHA-256) are always `フィンガープリント` in Japanese; `指紋` is strictly physical/biometric human fingerprints. |
| **attachment** *(session / pane attachment)* | `アタッチメント` (`別のアタッチメントが所有`, `アタッチメントの消失`) | `接続` (`別の接続が所有`, `接続の切断後`) | `アタッチメント` means a physical tool attachment or email file attachment (`添付ファイル`), never an attached terminal/tmux/session client. |
| **retired attempts** | `退避済み試行` | `終了済み試行` | `退避` means evacuating or backing up data to a safe place. `retired` in the flow ledger means old attempts that have finished or been superseded. |
| **observation** *(input observation)* | `観測` (`新しい観測が必要です`, `ネイティブ入力の観測`) | `確認` / `状態記録` | `観測` is scientific/astronomical/meteorological observation, not tracking input state in a CLI. |
| **Child writers** | `子の書き込み` | `書き込み可能な子エージェント` | `writer` here is an agent role/process (a child agent with write access), not the act of writing (`書き込み`). `子の書き込みが同じワークスペースを共有する` obscures what the setting controls. |
| **Child runs** | `子の実行` (`子の実行はありません`) | `子エージェントの実行` | Omitting `エージェント` makes `子の実行` read literally as "execution of a child" (compare `Child run dashboard`, which was properly expanded to `子エージェントの実行ダッシュボード`). |
| **global recents** | `グローバルの最近` (`グローバルの最近 { $recents } 件`) | `全体の履歴` | `最近` ("recently") is an adverb/temporal noun that cannot take a counter (`最近 5 件`). Elsewhere in the model picker, `Recent` is translated as `履歴`. |
| **optional unavailable** / **required unavailable** | `省略可能な利用不可 { $optional } 件` / `必須の利用不可あり` | `利用不可（任意） { $optional } 件` / `利用不可（必須）あり` | `省略可能な利用不可` literally means "an omittable unavailability"—the modifier `省略可能な` attaches to `利用不可` instead of the elided noun ("extensions"). |
| **optional** *(runtime / extension / profile)* | `省略可能な` (`省略可能な Camoufox 実行環境`, `省略可能な JA プロファイル`) | `任意の` / `オプションの` | `省略可能な` ("omittable") applies to syntax/arguments (`省略可能な --json`), not optional software packages, runtimes, or profiles. |
| **withheld** *(vs. **held**)* | `保留` (16) / `抑止` (1) | `差し止め` (`差し止め中`, `差し止められたリクエスト`) | Collides with `held` (`保留`). Use `差し止め` consistently across Flow and TextGuard (`保留、差し止め、待機、未解決...`), reserving `保留` for `held`. |
| **subagent(s)** / **Subagent** | `子エージェント` (20) / `サブエージェント` (4) | `サブエージェント` (for `subagent`) & `子エージェント` (for `child agent`) | Use `サブエージェント` whenever the English source is `subagent(s)` (including `jouzu.cli.tool.subagent.label`), and `子エージェント` when the English source is `child` / `child agent`. Remove `Subagent` from the protected English list in `docs/localization-glossary.md`. |
| **Workflow** *(Palette view name)* | `ワークフロー` (8) / `Workflow` (2) | `Workflow` (when naming the UI view) | `docs/localization-glossary.md` marks `Workflow` as a protected Palette product noun, and the actual view header is `· Workflow`. Translating *"in Workflow"* as `ワークフローで` in error messages breaks UI label matching. |
| **policy** *(language / artifact / context / keybinding)* | `ポリシー` (16) / `方針` (11) | `ポリシー` (`プロジェクト言語ポリシー`, `成果物ポリシー`) | Unify all occurrences of `policy` on `ポリシー` instead of splitting between `ポリシー` and `方針`. |
| **payload admission** / **admission** | `ペイロード受理` / `ペイロードの受け付け` / `セマンティック受理` / `受け付け` | `ペイロード受付` / `受付` | Split between `受理` and `受け付け` across adjacent `jouzu.cli.flow.*` messages; unify on `受付` (`受け付け`). |
| **reconciliation** | `再調整` (`復旧の再調整`, `削除の再調整`) | `整合性の回復` / `同期` | `再調整` means "readjustment/rescheduling" (e.g., scheduling a meeting), not state reconciliation in a distributed/transactional ledger. |
| **receipt** / **receipt evidence** | `受領記録` / `受領` | `受付記録` / `送信記録` | In `Request ended before payload admission. No send was recorded; the receipt does not identify the cause`, calling an unaccepted/unsent attempt record `受領記録` ("record of receipt") is self-contradictory. |
| **Install channel** / **Self-update channel** | `導入方法` / `自己更新の導入方法` | `インストール方法` / `自己更新のインストール方法` | `導入` is enterprise deployment jargon, and the values right next to it are `グローバル npm インストール`, `npx インストール`, etc. |
| **Release-owned extensions** / **Package-owned skills** | `リリース所有の拡張機能` / `パッケージ所有のスキル` | `同梱の拡張機能` / `パッケージ同梱のスキル` | "Release-owned" is internal repo-boundary jargon; in Japanese, a "release" (`リリース`) is not an entity that "owns" (`所有`) features. |
| **user** | `利用者` (9 in `cli.ftl`) / `ユーザー` (3 in `profile-migration-command.ftl`) | `ユーザー` | Standardize on `ユーザー` (`ユーザーのバインド`, `完了したユーザーのターン`, `tmux ユーザー`) across all `.ftl` files. |
| **UI locale** / **UI language** / **Display language** | `UI 言語` (6) / `表示言語` (5) | `表示言語` (keeping identifier `uiLocale` intact) | Use `表示言語` consistently for user-facing settings, help text, and diagnostic labels (`有効な表示言語`, `要求した表示言語`, `表示言語の取得元`), keeping the technical identifier `uiLocale` unchanged. |
| **sign-in** / **login** *(in prose)* | `サインイン` (24) / `ログイン` (3) / `再ログイン` (1) | `サインイン` / `再サインイン` | The 3 `ログイン` / `再ログイン` occurrences (`catalog.sync.authFailed`, `settings.credential.login`, `voice.requiresLogin`) are ordinary explanatory prose; unify on `サインイン` while keeping `/login` unchanged. |
| **transcript** *(session transcript)* | `会話記録` (10) / `トランスクリプト` (2) / `記録` (1) | `会話記録` | Refers to the same session log in `scrollback.*` (`会話記録`) and `flow.registry.*` (`トランスクリプト`), using different words per module. |
| **refresh** *(model catalog)* | `取得` (17) / `再取得` (9) / `更新` (8) | `更新` (or `再取得` for failures) | "Model catalog refresh" alternates between `モデルカタログの取得` ("fetch/acquisition") and `モデルカタログの更新` ("update/refresh"). |
| **plan** *(profile / keybinding plan)* | `計画` (`プロファイル計画`) / `プラン` (`プロファイル移行プラン`) | `プラン` | `jouzu.cli.profile.title` uses `Jouzu プロファイル計画`, while `jouzu.cli.profileMigration.*` uses `Jouzu プロファイル移行プラン`. |
| **Fetch URL** / **Search web** / **Parent Context** / **Subagent** *(tool labels)* | `URL を取得` / `ウェブを検索` / `親コンテキスト` / `子エージェント` | Keep Japanese (`URL を取得` / `ウェブを検索` / `親コンテキスト` / `サブエージェント`); remove from glossary protected list | Remove `Parent Context`, `Subagent`, `Fetch URL`, and `Search web` from the "Palette product nouns" list in `docs/localization-glossary.md` so the glossary matches the localized tool labels. |
| **Active** *(active context / active model call / active scope)* | `有効な` (`有効なコンテキスト`, `有効なモデル呼び出し`, `有効なモデルスコープ`) | `現在の` / `実行中の` (`現在のコンテキスト`, `実行中のモデル呼び出し`) | In Japanese, `有効な` means "valid/enabled," not "currently active/in-flight." `有効なモデル呼び出しが完了するまで待ってから` ("wait until the valid model call finishes") and `有効なコンテキストを圧縮` ("compact the valid context") mistranslate `active`. |
| **Scoped** *(project scopes / scoped models)* | `プロジェクトスコープ { $scopes } 件` / `スコープ内のモデル` | `対象モデル設定` / `対象モデル` | `プロジェクトスコープ 3 件` in `jz doctor` means 3 projects with saved scoped-model lists, not 3 "scopes." |
| **Context** / **Provider** *(Model Picker columns)* | `文脈長` / `提供元` (`runtime.ftl`) | `コンテキスト` / `プロバイダー` | Everywhere else in `cli.ftl`, `context` is `コンテキスト` (36x) and `provider` is `プロバイダー` (18x), but the Model Picker table headers (`jouzu.cli.modelPicker.columnContext` / `columnProvider`) switch to `文脈長` and `提供元`. |
| **Scheduled** *(dashboard section)* / **queued** *(model switch)* | `予約` (`jouzu.cli.session.dashboard.section.prompt`, `modelPicker.switchQueued`) | `スケジュール済み` (dashboard) / `待機中`・`次回適用` (queued switch) | Collides with flow-control `reservation` (`予約`). In the session dashboard, `Scheduled` (scheduled prompts) is rendered simply as `予約`, which looks like a flow reservation rather than a scheduled task/prompt. |
| **detached** *(session status)* | `ブランチなし` (`jouzu.cli.session.status.detached`) | `切り離し` / `デタッチ` | In `jouzu.cli.flow.input.multiloopResume`, `detached` is `切り離された`, whereas in `session.status.detached` it is translated as `ブランチなし` ("no branch"), which can be confused with Git branch state. |
| **Assets** *(profile migration)* | `資産` (`jouzu.cli.profileMigration.assets`) | `アセット` / `管理ファイル` | `資産` in Japanese means financial/real-estate assets or corporate property. In software/profile contexts (`profiles/core/assets/`), it is canonically `アセット` or `ファイル`. |
| **Confirmation window** *(Shisa sign-in)* | `確認ウィンドウ` (`確認ウィンドウが期限切れになると`) | `確認期限` (`確認期限を過ぎるとアクセスできなくなるため、もう一度サインインしてください。`) | `window` in `when the confirmation window expires` (`jouzu.cli.shisa.signIn.confirmFailed`) is a **time window** (deadline), not a GUI window (`ウィンドウ`). Also update English to `"when the confirmation deadline passes"` (both Chinese drafts made the same `窗口`/`視窗` error). |
| **Finding(s) that blocked nothing** *(TextGuard)* | `何も妨げなかった検出` (`表示できる、何も妨げなかった検出はありません`) | `内容をブロックしなかった検出` / `コンテンツをブロックしなかった検出結果` (`TextGuard に、...はありません。`) | Fix English to `"findings that did not block content"`, restore `TextGuard` in `reports.empty`, and avoid wording that implies a safety verdict. |
| **exact alias** (`help.footer.line1`) | `` `jz` コマンドは正確な別名です `` | `` `jz` は `jouzu` と同じ動作をする別名です `` | `正確な別名` is a literal translation that omits what `jz` is an alias for; also update English to `"jz is an alias for jouzu and behaves identically."` |
| **Saved setting** *(localization scope)* | `保存された既定値` (`jouzu.cli.localization.settings.scope.environment`) | `保存された設定` (or `全体の既定値`) | Translates `setting` as `既定値` ("default value"), which clashes with `Reset to the defaults` (`既定値に戻しました`) in the same dialog—applying a custom saved setting is the opposite of resetting to factory defaults. |
| **Slash commands without backticks** *(18 prose entries)* | `/flow`, `/login shisa`, `/reload`, `/textguard`, `/labels`, `/fast` | `` `/flow` ``, `` `/login shisa` ``, `` `/reload` ``, `` `/textguard` ``, `` `/labels` ``, `` `/fast` `` | Per `docs/localization-glossary.md`, Japanese prose wraps slash commands in ASCII backticks; 18 prose entries omit them. |
| **Cross-message sentence fragments** (`help.footer.line1..7`, `help.textguard.line1..4`) | Sentences split mid-clause across 7 numbered `footer.line*` IDs and 4 `textguard.line*` IDs | Group into self-contained topic messages; let the renderer wrap at 48/80/120 columns | Because Japanese is SOV, clauses had to be moved across `line4`–`line7` in Japanese so individual `lineN` IDs no longer correspond to their English counterparts. |
| **bearer-token spacing** | `このカタログがbearer トークン認証` / `受け入れるbearer トークン` | `このカタログが bearer トークン認証` / `受け入れる bearer トークン` | Missing half-width space before `bearer` in 4 entries (`catalog.discovery.accessDenied`, `accessDeniedBearer`, `authFailed`, `authFailedBearer`). |

---

## 1. Protected-Value and UI Navigation Violations

`docs/localization-glossary.md` defines **Palette product nouns** (`Workflow`, `Dashboard`, `Subagent`, `Models`, `Catalogs`, `Settings`) as protected values that stay in English when naming a UI view or tool label. Several entries translate these names into Japanese, creating a mismatch between the error or hint text and the English UI label on screen.

### `Workflow` (UI view name) → `ワークフロー` vs. `Workflow`

* **Affected IDs:**
  * `jouzu.cli.subagent.disabledForSession`: *"Subagents are off for this session. The user can enable them in Workflow or with /workflow on."* → `このセッションでは子エージェントがオフです。利用者はワークフローまたは /workflow on で有効にできます。`
  * `jouzu.cli.subagent.modelArgumentUserOnly`: *"Only the user can change subagent models in Workflow. Omit the model argument."* → `サブエージェントのモデルをワークフローで変更できるのは利用者だけです。model 引数は省略してください。`
  * `jouzu.cli.subagent.modelUnavailable`: *"Model: { $selector } is unavailable. Choose an available model in Workflow."* → `モデル: { $selector } は利用できません。ワークフローで利用可能なモデルを選んでください。`
* **Impact:** The actual view title (`jouzu.cli.workflow.title`) is rendered in English (`· Workflow{ $stage }`), and `jouzu.cli.workflow.error.subagentsOff` keeps `Workflow で有効にしてください`. Translating the view name as `ワークフロー` in `subagent.*` breaks consistency with both the UI header and the glossary.
* **Recommendation:** Keep `Workflow` in English when referring to the Palette view (`Workflow で...`).

### `Subagent` (Tool label and concept) → `子エージェント` vs. `サブエージェント`

* **Affected IDs:**
  * `jouzu.cli.tool.subagent.label`: *"Subagent"* → `子エージェント`
  * `jouzu.cli.subagent.callLabel`: *"Subagent · { $operation }"* → `サブエージェント · { $operation }`
  * `jouzu.cli.subagent.modelArgumentUserOnly`, `jouzu.cli.subagent.operationUnsupported`, `jouzu.cli.subagent.stopIncomplete`: use `サブエージェント` (4 entries total), while 20 other `subagent.*` / `workflow.*` entries translate `subagent(s)` as `子エージェント`.
* **Impact:** The glossary lists `Subagent` under protected Palette product nouns, and the codebase mixes `子エージェント` and `サブエージェント` within the same module (`jouzu.cli.subagent.*`).
* **Recommendation:** Align tool labels with `docs/localization-glossary.md` and unify prose occurrences of `subagent` to a single Japanese term (`サブエージェント` or `子エージェント`).

---

## 2. Unintelligible or Ungrammatical Nominalizations

Several English nouns are translated using bare Japanese verb stems (`連用形`) or truncated adjective phrases that cannot function as countable standalone nouns.

### `offering(s)` → `提供` ("act of providing")

* **Affected IDs (12 entries):**
  * `jouzu.cli.settings.empty.noOfferings`: *"No cached model offerings."* → `キャッシュされた提供がありません。`
  * `jouzu.cli.catalog.registrationEffect`: *"An offering for a model Pi does not already provide is dropped, so that model never reaches the model list."* → `Pi がまだ提供していないモデルの提供は破棄されるため、そのモデルがモデル一覧に到達することはありません。`
  * `jouzu.cli.catalog.field.registrationValue`, `thinkingLevelsValue`, `note.registrationGaps`, `note.thinkingLevels`, `doctor.value.catalogRegistration`, `doctor.value.catalogSource`, `doctor.value.catalogThinkingLevels`, `doctor.warning.catalogRegistration`, `doctor.warning.catalogThinkingLevels`: *"{ $count } of { $total } offerings..."* → `提供 { $total } 件のうち { $count } 件が...`
* **Impact:** In Japanese, `提供` is the verbal action of providing, not a countable catalog item. `キャッシュされた提供がありません` ("there are no cached acts of providing") and `モデルの提供は破棄される` are unintelligible without guessing the underlying English word.
* **Recommendation:** Translate `offering(s)` as `提供モデル` (offered model) or `モデル定義` (e.g., `キャッシュされた提供モデルがありません`, `提供モデル { $total } 件のうち...`).

### `global recents` → `グローバルの最近` ("global recent")

* **Affected ID:**
  * `jouzu.cli.doctor.value.modelPicker`: *"{ $defaults } project defaults; { $favorites } favorites; { $recents } global recents; { $scopes } project scopes"* → `プロジェクト既定 { $defaults } 件、お気に入り { $favorites } 件、グローバルの最近 { $recents } 件、プロジェクトスコープ { $scopes } 件`
* **Impact:** `最近` ("recently") cannot take a counter (`最近 5 件`). In `jouzu.cli.modelPicker.filter.recent`, `Recent` is translated as `履歴`.
* **Recommendation:** Use `全体の履歴 { $recents } 件` or `最近使用したモデル（全体） { $recents } 件`.

### `optional unavailable` / `required unavailable` → `省略可能な利用不可` / `必須の利用不可`

* **Affected IDs:**
  * `jouzu.cli.doctor.value.extensionsReleaseOwned`: *"{ $selected } selected; { $ready } ready; { $optional } optional unavailable"* → `選択 { $selected } 件、準備完了 { $ready } 件、省略可能な利用不可 { $optional } 件`
  * `jouzu.cli.doctor.value.extensionsReleaseOwnedRequired`: *"{ $selected } selected; { $ready } ready; { $optional } optional unavailable; required unavailable"* → `選択 { $selected } 件、準備完了 { $ready } 件、省略可能な利用不可 { $optional } 件、必須の利用不可あり`
* **Impact:** `省略可能な利用不可` literally means "an omittable unavailability"—the modifier `省略可能な` attaches to `利用不可` rather than the elided noun ("extensions").
* **Recommendation:** Use `利用不可（任意） { $optional } 件、利用不可（必須）あり` or `任意拡張の利用不可 { $optional } 件`.

### `Child writers` → `子の書き込み` ("child's writing")

* **Affected IDs:**
  * `jouzu.cli.workflow.row.childWriters`: *"Child writers"* → `子の書き込み`
  * `jouzu.cli.workflow.message.childWritersSerial`: *"Child writers run one at a time per workspace."* → `子の書き込みはワークスペースごとに 1 つずつ実行されます。`
  * `jouzu.cli.workflow.message.childWritersParallel`: *"Child writers may share a workspace; concurrent edits to the same files can conflict."* → `子の書き込みが同じワークスペースを共有する場合、同じファイルへの同時編集が競合することがあります。`
* **Impact:** `writer` refers to a write-capable child agent, not the act of writing (`書き込み`). Saying "A child's write shares a workspace" obscures that this setting controls whether write-capable child agents execute serially or in parallel.
* **Recommendation:** Use `書き込み可能な子エージェント` or `書き込み子エージェント`.

### `Child runs` → `子の実行` ("execution of a child")

* **Affected IDs:**
  * `jouzu.cli.subagent.noChildRuns`: *"No child runs."* → `子の実行はありません。`
  * `jouzu.cli.workflow.empty.noChildRuns`: *"No child runs in this session."* → `このセッションに子の実行はありません。`
  * `jouzu.cli.subagent.commandDescription`, `jouzu.cli.subagent.paneEnabled`
* **Impact:** Dropping `エージェント` from `Child` makes `子の実行` read as "execution of a child." Compare `jouzu.cli.help.overlay.childDashboard`, which expands *"Child run dashboard"* to `子エージェントの実行ダッシュボード`.
* **Recommendation:** Use `子エージェントの実行` (e.g., `子エージェントの実行はありません`).

---

## 3. Opaque Calques for Internal Architecture Terms

Several infrastructure or state-machine metaphors are translated word-for-word into Japanese terms from mathematics, medicine, or biometrics that do not carry the intended software meaning.

### `converged` / `already converged` → `収束済み` / `すでに収束しています`

* **Affected IDs:**
  * `jouzu.cli.keybindings.alreadyConverged`: *"Keybinding defaults already converged."* → `キーバインド既定はすでに収束しています。`
  * `jouzu.cli.keybindings.status.converged`: *"converged"* → `収束済み`
  * `jouzu.cli.profile.alreadyConverged`: *"Profile already converged"* → `プロファイルはすでに収束しています`
* **Impact:** In Japanese, `収束` refers to mathematical series convergence or an outbreak/crisis subsiding. It is not used in user-facing CLI messages to mean "configuration already matches the target state."
* **Recommendation:** Use `適用済み` / `すでに適用済みです（変更不要）` or `一致しています`.

### `quarantined` → `検疫されました` / `検疫中の候補`

* **Affected IDs:**
  * `jouzu.cli.catalog.field.quarantined`: *"Quarantined candidates"* → `検疫中の候補`
  * `jouzu.cli.catalog.note.quarantined`: *"{ $count } candidate revisions are quarantined."* → `{ $count } 件の候補リビジョンが検疫されています。`
  * `jouzu.cli.settings.savedQuarantined`: *"Saved { $label }. Catalog revision quarantined: { $reasons }."* → `{ $label } を保存しました。カタログリビジョンは検疫されました: { $reasons }。`
* **Impact:** `検疫` refers to medical/customs inspection or antivirus scanning. Here, a catalog revision failed validation or acceptance criteria and is isolated from active use.
* **Recommendation:** Use `隔離` (`隔離された候補`, `{ $count } 件の候補リビジョンが隔離されています`) or `保留（隔離）`.

### `Content fingerprint (SHA-256)` → `内容の指紋（SHA-256）`

* **Affected ID:**
  * `jouzu.cli.textguard.review.fingerprint`: *"Content fingerprint (SHA-256): { $digest }"* → `内容の指紋（SHA-256）: { $digest }`
* **Impact:** In cryptographic and developer tools (SSH, TLS, Git, SHA-256), "fingerprint" is canonically `フィンガープリント` (or `ハッシュ値`). `指紋` is used only for physical/biometric human fingerprints (`指紋認証`).
* **Recommendation:** Use `内容のフィンガープリント（SHA-256）: { $digest }`.

### Low-Level Flow Ledger Jargon (`attachment`, `observation`, `retired attempts`, `semantic admission`, `reconciliation`)

* **Affected IDs:**
  * `jouzu.cli.flow.ownership.busy`: *"This session branch is already owned by another attachment."* → `このセッションブランチは既に別のアタッチメントが所有しています。`
  * `jouzu.cli.flow.ledger.outcomeUnknown`: *"Request outcome unknown after attachment loss."* → `アタッチメントの消失後、要求の結果は不明です。`
  * `jouzu.cli.sessionLabels.notify.paneUnavailable`: *"Pane unavailable or owned by another attachment; title preserved."* → `ペインを利用できないか、別のアタッチメントが所有しています。タイトルは保護されました。`
  * `jouzu.cli.flow.native.editedInput`: *"Edited native input requires a new observation."* → `ネイティブ入力を編集したため、新しい観測が必要です。`
  * `jouzu.cli.flow.native.observationRetained`: *"Native input observation could not be retained."* → `ネイティブ入力の観測を保持できませんでした。`
  * `jouzu.cli.flow.ledger.invalidRetiredAttempts`: *"Invalid retired attempts."* → `退避済み試行が無効です。`
  * `jouzu.cli.flow.ingress.semanticAdmission`: *"Input is waiting for updated semantic admission."* → `入力は更新されたセマンティック受理を待っています。`
  * `jouzu.cli.flow.ingress.recoveryReconciliation`, `submission.deferredContextCancellation`, `submission.queueCancellation`: *"reconciliation"* → `再調整`
* **Impact:**
  * `アタッチメント` in Japanese means a physical machinery attachment or an email attachment (`添付ファイル`), not an attached terminal/session client.
  * `観測` ("astronomical/meteorological observation") is unnatural for runtime state tracking (`監視` or `確認`).
  * `退避済み試行` ("evacuated/backed-up attempts") mistranslates `retired` (which means completed/superseded/discarded: `終了済み試行` or `破棄済み試行`).
* **Recommendation:**
  * Replace `アタッチメント` with `接続` or `アタッチされたプロセス` (`別の接続が使用しています`, `接続が切れたため...`).
  * Replace `退避済み試行` with `終了済み試行` or `過去の試行記録`.

---

## 4. Concept Collisions (Two Distinct Concepts Mapped to One Japanese Term)

### `held` vs. `withheld` → Both Translated as `保留`

* **Affected IDs:**
  * `held` (14 entries): `リクエストの保留`, `保留中の入力`, `保留された結果`
  * `withheld` (15 of 16 entries): `保留されたリクエスト` (`jouzu.cli.flow.notice.withheldRequestNeedsClear`, `jouzu.cli.work.withheldRequest`), `保留中の内容` (`jouzu.cli.textguard.detail.withheld`), `保留中` (`jouzu.cli.textguard.status.withheld`)
  * `jouzu.cli.flow.status.nothingHeld`: *"Nothing is held, withheld, waiting, or unresolved."* → `保留、抑止、待機、未解決のいずれもありません。`
* **Impact:** Because `held` (flow-control queue hold) and `withheld` (blocked by TextGuard or policy) both appear in `/flow` and both use `保留`, the translator had to introduce `抑止` in `nothingHeld` to avoid writing `保留、保留...`. However, `jouzu.cli.flow.notice.withheldRequestNeedsClear` (*"A withheld request still needs /flow clear."*) still uses `保留されたリクエスト`, making it impossible for the user to connect `抑止` in `/flow` status with `保留されたリクエスト`.
* **Recommendation:** Use a distinct term for `withheld` across both Flow and TextGuard—such as `差し止め` or `抑止` (`差し止められたリクエスト`, `差し止め中`)—reserving `保留` for `held`.

### `UI locale` vs. `UI language` → Both Translated as `UI 言語`

* **Affected IDs:**
  * `jouzu.cli.doctor.field.localization.effective`: *"UI locale effective"* → `有効な UI 言語`
  * `jouzu.cli.doctor.field.localization.requested`: *"UI locale requested"* → `要求した UI 言語`
  * `jouzu.cli.doctor.field.localization.source`: *"UI locale source"* → `UI 言語の取得元`
  * `jouzu.cli.doctor.field.localization.fallback`: *"UI locale fallback reason"* → `UI 言語のフォールバック理由`
  * `jouzu.cli.localization.uiLocaleUnsupported`: *"localization.uiLocale is not a supported UI locale: { $value }"* → `localization.uiLocale はサポートされていない UI 言語です: { $value }`
* **Impact:** `Locale` (`jouzu.cli.doctor.field.locale`), `OS locale`, and `canonical locale` are all translated using `ロケール` (`OS ロケール`, `正規ロケール`), while `UI locale` is translated as `UI 言語`.
* **Recommendation:** Use `UI ロケール` when the source specifically says `UI locale` (especially next to the `uiLocale` property name and in `jz doctor`).

---

## 5. Cross-File Inconsistencies and Register Issues

### `user` → `利用者` (in `cli.ftl`) vs. `ユーザー` (in `profile-migration-command.ftl`)

* **Affected IDs:**
  * `cli.ftl` (9 entries): `利用者のバインド` (*user bindings*), `完了した利用者ターン` (*completed user turn(s)*), `tmux 利用者` (*tmux users*), `利用者だけです` (*only the user*).
  * `profile-migration-command.ftl` & `cli.ftl` (`profileMigration.temporary`): `ユーザー全体の設定` (*user-wide settings*).
* **Impact:** `利用者` is formal administrative/public-service register, whereas `ユーザー` is standard across developer tools. In particular, `完了した利用者ターン` (`jouzu.cli.sessionLabels.status.revisit`) reads unnaturally compared to `ユーザーのターン`.
* **Recommendation:** Standardize on `ユーザー` across all `.ftl` files.

### `optional` → `省略可能な` Used for Software Components and Profiles

* **Affected IDs:**
  * `jouzu.cli.doctor.field.camoufox.runtime`, `problem.camoufoxRuntimeInvalid`: *"Optional Camoufox runtime"* → `省略可能な Camoufox 実行環境`
  * `jouzu.cli.doctor.problem.extensionsOptionalUnavailable`: *"Optional release extensions"* → `省略可能なリリース所有拡張機能`
  * `jouzu.cli.profile.choice.intro`, `help.footer.line3`: *"optional Japanese-support profile"* / *"optional JA profile"* → `省略可能な日本語サポートプロファイル` / `省略可能な JA プロファイル`
* **Impact:** `省略可能な` ("omittable") is natural for syntax and CLI flags (`optional --json` → `省略可能な --json`), but unnatural for optional software components, extensions, or profiles (which are not "omitted" from an expression).
* **Recommendation:** Use `任意の` or `オプションの` for software runtimes, extensions, and profiles, keeping `省略可能な` for CLI arguments and syntax.

### `payload admission` / `admission` → `ペイロード受理` vs. `ペイロードの受け付け` vs. `受け付け`

* **Affected IDs:**
  * `jouzu.cli.flow.native.compactionProviderFailed`, `providerFailed`: `ペイロード受理の前に...`
  * `jouzu.cli.flow.status.requestEndedBeforeAdmission`: `ペイロードの受け付け前に...`
  * `jouzu.cli.flow.notice.pauseAfterAdmissionFailure`: `受け付けの失敗により...`
  * `jouzu.cli.flow.ingress.hostAdmission`: `ホストの受理ポリシー`
* **Impact:** The same flow-control stage (`payload admission` / `admission`) alternates between `受理` and `受け付け` within `jouzu.cli.flow.*`.
* **Recommendation:** Standardize on one term (`受付` / `受け付け` or `受理`) across all `jouzu.cli.flow.*` messages.

### `transcript` → Split Between `会話記録`, `トランスクリプト`, and `記録`

* **Affected IDs:**
  * `jouzu.cli.scrollback.*` (10 entries): *"Transcript export"* → `会話記録の出力`
  * `jouzu.cli.flow.registry.rebuilt`, `rebuiltSaved` (2 entries): *"Flow state was rebuilt from the transcript."* → `フロー状態はトランスクリプトから再構築されました。`
  * `jouzu.cli.subagent.parentTranscriptUnavailable` (1 entry): *"Trace: the parent session has no saved transcript yet."* → `トレース: 親セッションにはまだ保存された記録がありません。`
* **Impact:** All three refer to the session conversation transcript (distinct from `voice.transcriptInvalid`, which is speech-to-text `文字起こし結果`), but use three different nouns.
* **Recommendation:** Use `会話記録` (or `セッション記録`) consistently for session transcripts.

### `Install channel` / `Self-update channel` → `導入方法` ("deployment/introduction method")

* **Affected IDs:**
  * `jouzu.cli.doctor.field.update.channel`: *"Self-update channel"* → `自己更新の導入方法`
  * `jouzu.cli.doctor.field.update.installChannel`, `selfUpdate.installChannel`: *"Install channel"* → `導入方法`
  * `jouzu.cli.selfUpdate.unsupportedChannel`: *"update this source, local, or npx invocation through its owning channel"* → `このソース、ローカル、または npx の実行は、それぞれの導入方法で更新してください`
* **Impact:** Since the values displayed next to this label are `グローバル npm インストール`, `ローカル npm インストール`, `npx インストール`, and `ソースチェックアウト`, calling the field `インストール方法` (or `インストール経路`) is more direct than enterprise IT `導入方法`.

### `Release-owned extensions` / `Package-owned skills` → `リリース所有の拡張機能` / `パッケージ所有のスキル`

* **Affected IDs:**
  * `jouzu.cli.doctor.field.extensions.releaseOwned`, `problem.extensionsManifestInvalid`, `problem.extensionsOptionalUnavailable`, `problem.extensionsUnavailable`, `releaseExtensions.*`: `リリース所有の拡張機能` / `リリース所有拡張機能` / `リリース所有ツール`
  * `jouzu.cli.doctor.field.skills.packageOwned`: `パッケージ所有のスキル`
* **Impact:** "Release-owned" and "package-owned" are internal repository-boundary terms. Literal translation into `リリース所有` ("owned by the release") reads awkwardly in Japanese `jz doctor` output because a "release" is not an actor that owns things in natural Japanese.
* **Recommendation:** Use `同梱の拡張機能` / `Jouzu 標準の拡張機能` (or `リリース同梱の拡張機能`) and `パッケージ同梱のスキル`.

---

## 6. Additional String-Level Findings (Full Pass Across All 1,576 Fluent IDs & Desktop Launcher)

### A. Protected Tool Labels Translated in `jouzu.cli.tool.*`
* **Affected IDs:**
  * `jouzu.cli.tool.fetchUrl.label`: *"Fetch URL"* → `URL を取得`
  * `jouzu.cli.tool.searchWeb.label`: *"Search web"* → `ウェブを検索`
  * `jouzu.cli.tool.parentContext.label`: *"Parent Context"* → `親コンテキスト`
  * `jouzu.cli.tool.subagent.label`: *"Subagent"* → `子エージェント`
* **Impact:** `docs/localization-glossary.md` explicitly lists `Parent Context`, `Subagent`, `Fetch URL`, and `Search web` under **Protected values → Palette product nouns** (*"These stay as written in every locale. A translator never renders them in another script."*), while `jouzu.cli.doctor.upstreamConstraint` states *"the Jouzu-owned browser adapter renders its tool labels from the Jouzu catalog."* The glossary and the catalog directly contradict each other here.

### B. `active` Mistranslated as `有効な` ("valid/enabled") Instead of `現在の` / `実行中の`
* **Affected IDs:**
  * `jouzu.cli.modelPicker.waitForActiveCall`: *"Wait for the active model call to finish, then compact and switch."* → `有効なモデル呼び出しが完了するまで待ってから、圧縮して切り替えてください。`
  * `jouzu.cli.modelPicker.compactAndSwitch`: *"Compact the active context and switch to { $model }?"* → `有効なコンテキストを圧縮して { $model } に切り替えますか？`
  * `jouzu.cli.modelPicker.noFavoriteFits`: *"No favorite model can fit the active context."* → `有効なコンテキストに収まるお気に入りモデルがありません。`
  * `jouzu.cli.modelPicker.noFavoriteModelsAvailable`: *"No favorite models are available in the current model scope."* → `有効なモデルスコープで利用できるお気に入りモデルがありません。`
* **Impact:** In Japanese, `有効な` means "valid" or "enabled" (as in `Active catalogs` → `有効なカタログ`). An in-flight API request (`active model call`) is `実行中のモデル呼び出し`, and the current session context (`active context`) is `現在のコンテキスト`.

### C. `confirmation window` Mistranslated as GUI Window (`確認ウィンドウ`)
* **Affected IDs:**
  * `jouzu.cli.shisa.signIn.confirmFailed`: *"Shisa sign-in was saved, but confirmation failed. Sign in again to avoid losing access when the confirmation window expires."* → `Shisa のサインインは保存されましたが、確認に失敗しました。確認ウィンドウが期限切れになるとアクセスを失うため、もう一度サインインしてください。`
  * `jouzu.cli.shisa.signIn.confirmInterrupted`: *"Shisa sign-in was saved, but confirmation was interrupted. Sign in again to avoid losing access when the confirmation window expires."* → `Shisa のサインインは保存されましたが、確認が中断されました。確認ウィンドウが期限切れになるとアクセスを失うため、もう一度サインインしてください。`
* **Impact:** `confirmation window` is a **time window** (grace period for confirming the device token), not a GUI window (`ウィンドウ`). `確認ウィンドウが期限切れになる` reads as if a browser popup window expires.
* **Recommendation:** Use `確認の有効期限が切れると` or `確認期間が終了すると`.

### D. `Assets` Translated as Financial/Property `資産`
* **Affected ID:**
  * `jouzu.cli.profileMigration.assets`: *"Assets"* → `資産`
* **Impact:** In profile migration (`profiles/core/assets/`), "Assets" refers to managed profile files (skills and prompt markdown files). In Japanese, `資産` means financial, real-estate, or corporate assets.
* **Recommendation:** Use `アセット` or `管理ファイル`.

### E. `Scheduled` (Dashboard Section) and `queued` (Model Switch) Colliding with `予約` (`reservation`)
* **Affected IDs:**
  * `jouzu.cli.session.dashboard.section.prompt`: *"Scheduled"* → `予約`
  * `jouzu.cli.modelPicker.switchQueued`: *"Model switch queued for the next model call: { $model }."* → `モデルの切り替えを次のモデル呼び出しに予約しました: { $model }。`
  * `jouzu.cli.modelPicker.queuedSwitchFailed`: *"Queued model switch failed: { $message }"* → `予約したモデル切り替えに失敗しました: { $message }`
* **Impact:** In the session dashboard, `Scheduled` (scheduled prompts from `schedule_prompt`) is labelled `予約`, which is identical to flow-control `reservation` (`予約`).
* **Recommendation:** Use `スケジュール済み` (or `予定`) for the `Scheduled` dashboard section.

### F. Model Picker Column Headers in `runtime.ftl` Diverging from `cli.ftl`
* **Affected IDs:**
  * `jouzu.cli.modelPicker.columnContext`: *"Context"* → `文脈長`
  * `jouzu.cli.modelPicker.columnProvider`: *"Provider"* → `提供元`
* **Impact:** Every other string in `cli.ftl` uses `コンテキスト` for `Context` and `プロバイダー` for `Provider`, including `jouzu.cli.modelPicker.detail` (`コンテキスト { $context }`). Switching to `文脈長` and `提供元` in the table header creates a vocabulary split inside the same Model Picker view.

### G. `Saved setting` Translated as `保存された既定値` in Localization Scope
* **Affected ID:**
  * `jouzu.cli.localization.settings.scope.environment`: *"Saved setting"* → `保存された既定値`
* **Impact:** In the language settings dialog, the user chooses between `This session only` (`このセッションだけ`) and `Saved setting` (`保存された既定値`), while the same dialog has a `Reset` action that says `すべての言語設定を既定値に戻しますか？` (*"Reset every language setting to its default?"*). Calling a user-customized persistent setting `既定値` ("default value") confuses saving a custom setting with resetting to defaults.
* **Recommendation:** Use `保存された設定` (or `保存設定`).

### H. Awkward Double-Negative Calques in TextGuard (`findings that blocked nothing`)
* **Affected IDs:**
  * `jouzu.cli.textguard.reports.empty`: *"TextGuard has no findings that blocked nothing to show."* → `表示できる、何も妨げなかった検出はありません。`
  * `jouzu.cli.textguard.otherView.reports`: *"findings blocked nothing · { $command }"* → `件の検出は何も妨げませんでした · { $command }`
  * `jouzu.cli.textguard.review.blockedNothing`: *"{ $count } findings blocked nothing; see { $command }."* → `検出 { $count } 件は何も妨げませんでした。{ $command } を参照してください。`
  * `jouzu.cli.textguard.commandUsage`: `何も妨げなかった検出`
* **Impact:** Nearby TextGuard strings (`counts.blocking`, `counts.nonBlockingBoth`, `severity.error`) translate `block` as `ブロックします` / `ブロックしません`. Translating `findings that blocked nothing` as `何も妨げなかった検出` ("detections that hindered nothing") is both inconsistent with `ブロック` and awkward in Japanese (`表示できる、何も妨げなかった検出はありません`).
* **Recommendation:** Use `ブロックしなかった検出` (e.g., `ブロックしなかった検出はありません`).

### I. Missing Half-Width Space Before `bearer` in 4 Catalog Strings
* **Affected IDs:**
  * `jouzu.cli.catalog.discovery.accessDenied`: `このカタログがbearer トークン認証を必要とする場合は...`
  * `jouzu.cli.catalog.discovery.accessDeniedBearer`: `カタログが受け入れるbearer トークンが含まれているか...`
  * `jouzu.cli.catalog.discovery.authFailed`: `このカタログがbearer トークン認証を必要とする場合は...`
  * `jouzu.cli.catalog.discovery.authFailedBearer`: `カタログが受け入れるbearer トークンが含まれているか...`
* **Impact:** All other Latin tokens in `ja/cli.ftl` have a half-width space separating them from adjacent Japanese characters; these 4 entries omit the space before `bearer`.

### J. Desktop Launcher (`apps/launcher/src/i18n.ts`) Findings Outside Fluent
If your review also covers `non-fluent.csv`, note these issues in `apps/launcher/src/i18n.ts`:
* **Missing key in `ja` dictionary:** `checking: "確認中…"` is present in `hans` and `hant` at the top of `i18n.ts`, and in `en` at the bottom, and in `ja` at the bottom—worth verifying key parity.
* **`coreProfile: "基本"`:** In `cli.ftl`, the `Core` profile is kept in English (`Core プロファイルで続行します`, `Core が安全なフォールバックです`), whereas the desktop launcher translates `Core` as `基本`.
* **`jouzuUpdatePending`:** *"Jouzu updates: the qualified pnpm release source is not configured."* → `Jouzu 更新：検証済み pnpm リリース元は未設定です。` (internal developer message exposed in UI, and uses full-width colon `：` unlike the CLI's half-width `: `).

---

## 7. Approved Terminology Decisions and Test-Suite Impact

### A. Approved Decisions

1. **`Subagent` / `subagent(s)` → `サブエージェント` (and avoid bare `子`):**
   * Use `サブエージェント` for the feature or agent type (including `jouzu.cli.tool.subagent.label` and the 20 entries in `subagent.*` / `workflow.*` that currently say `子エージェント`).
   * Reserve `子エージェント` / `子セッション` for actual parent–child relationship contexts, and never leave bare `子` in user-facing instructions (e.g., `jouzu.cli.subagent.stopIncomplete`: `Runs を確認し、実行中の各サブエージェントに対して Stop を再試行してください。`; `jouzu.cli.workflow.confirm.disableSubagents`: `待機中および実行中のすべてのサブエージェントを停止しますか？`).
2. **Tool labels (`Fetch URL`, `Search web`, `Parent Context`, `Subagent`) → Remove from glossary protected list:**
   * Keep the localized Japanese tool labels (`URL を取得`, `ウェブを検索`, `親コンテキスト`, `サブエージェント`) and remove `Parent Context`, `Subagent`, `Fetch URL`, and `Search web` from the "Palette product nouns" list in `docs/localization-glossary.md`.
3. **`withheld` → `差し止め`:**
   * Use `差し止め` (`差し止め中`, `差し止められたリクエスト`, `保留、差し止め、待機、未解決のいずれもありません`) across all 16 `withheld` entries in Flow and TextGuard, reserving `保留` exclusively for `held`.
4. **`offering(s)` → `提供モデル`:**
   * Use `提供モデル` (`提供モデル { $total } 件`, `キャッシュされた提供モデルがありません`) across all 12 `offering(s)` entries.
5. **`policy` → `ポリシー`:**
   * Unify all `policy` translations on `ポリシー` (`プロジェクト言語ポリシー`, `成果物ポリシー`).
6. **`user` → `ユーザー`:**
   * Standardize on `ユーザー` across all `.ftl` files (`ユーザーのバインド`, `完了したユーザーのターン`, `tmux ユーザー`, `ユーザーだけです`).
7. **`display language` / `UI language` / `UI locale` → `表示言語` (keeping identifier `uiLocale` intact):**
   * Use `表示言語` consistently for the user-facing setting, help text, and diagnostic labels (`有効な表示言語`, `要求した表示言語`, `表示言語の取得元`, `表示言語のフォールバック理由`), while keeping the technical identifier `uiLocale` unchanged.
8. **`sign-in` / `login` → `サインイン` consistently in authentication prose:**
   * Replace the 3 explanatory occurrences of `ログイン` / `再ログイン` (`jouzu.cli.catalog.sync.authFailed`, `jouzu.cli.settings.credential.login`, `jouzu.cli.voice.requiresLogin`) with `サインイン` / `再サインイン` (`· Shisa サインインを使用中`, `Shisa のサインインまたは SHISA_API_KEY が必要です`), leaving `/login` unchanged.

---

## 8. Additional Structural and Source-Text Refinements

### A. Fix English Source Ambiguity First (`confirmation window` & `findings that blocked nothing`)

1. **`confirmation window` → `confirmation deadline` (`確認期限`):**
   * **Affected IDs:** `jouzu.cli.shisa.signIn.confirmFailed`, `jouzu.cli.shisa.signIn.confirmInterrupted`
   * **English source fix:** Change *"when the confirmation window expires"* to *"when the confirmation deadline passes"* (both `zh-Hans` and `zh-Hant` drafts also mistranslated `window` as a GUI window `窗口`/`視窗`).
   * **Japanese translation:** `確認期限を過ぎるとアクセスできなくなるため、もう一度サインインしてください。`
2. **`findings that blocked nothing` → `findings that did not block content` (`内容をブロックしなかった検出`):**
   * **Affected IDs:** `jouzu.cli.textguard.commandUsage`, `jouzu.cli.textguard.otherView.reports`, `jouzu.cli.textguard.reports.empty`, `jouzu.cli.textguard.review.blockedNothing`
   * **English source fix:** Specify *what* was not blocked (*"findings that did not block content"*) and preserve `TextGuard` in the empty-state message.
   * **Japanese translation:** `TextGuard に、内容をブロックしなかった検出はありません。` (or `コンテンツをブロックしなかった検出結果`, matching the catalog's choice for `content` / `finding`). Avoid wording that implies a safety verdict (`安全` / `問題なし`).

### B. Clarify "exact alias" (`jouzu.cli.help.footer.line1`)

* **Current EN:** *"The jz command is an exact alias. Resume with the jz --session command printed"*
* **Current JA:** `` `jz` コマンドは正確な別名です。終了時に表示される `jz --session` コマンドで再開します。 ``
* **Issue:** `正確な別名` ("accurate/exact alias") does not state what `jz` is an alias *for* or what "exact" means in practice.
* **Recommended EN:** *"jz is an alias for jouzu and behaves identically."*
* **Recommended JA:** `` `jz` は `jouzu` と同じ動作をする別名です。 ``

### C. Missing Backticks Around Slash Commands in Japanese Prose (18 Entries)

Per `docs/localization-glossary.md` (*"Japanese and Traditional Chinese use ASCII backticks"*), slash commands in prose should be wrapped in backticks (excluding command-list headings like `jouzu.cli.sessionLabels.command.*`). Currently, **18 prose entries** omit backticks around slash commands:

* **In `cli.ftl` (14 entries):**
  * `jouzu.cli.catalogSource.signedOut`: `/login shisa` → `` `/login shisa` ``
  * `jouzu.cli.flow.native.providerFailed`: `/flow` → `` `/flow` ``
  * `jouzu.cli.flow.native.providerNoAdmission`: `/flow` → `` `/flow` ``
  * `jouzu.cli.flow.service.resolvedSpent`: `/flow` → `` `/flow` ``
  * `jouzu.cli.flow.service.resolvedUndelivered`: `/flow` → `` `/flow` ``
  * `jouzu.cli.runtime.buildChanged`: `/flow runtime` → `` `/flow runtime` ``
  * `jouzu.cli.runtime.patchDiffers`: `/flow runtime` → `` `/flow runtime` ``
  * `jouzu.cli.runtime.patchUnavailable`: `/flow runtime` → `` `/flow runtime` ``
  * `jouzu.cli.sessionLabels.notify.useCommand`: `/labels` → `` `/labels` ``
  * `jouzu.cli.textguard.approved.reloadFailed`: `/reload` → `` `/reload` ``
  * `jouzu.cli.textguard.reloadFailed`: `/reload` → `` `/reload` ``
  * `jouzu.cli.textguard.review.expired`: `/textguard` → `` `/textguard` ``
  * `jouzu.cli.textguard.review.requiresSize`: `/textguard` → `` `/textguard` ``
  * `jouzu.cli.textguard.terminalResized`: `/textguard` → `` `/textguard` ``
* **In `runtime.ftl` (4 entries):**
  * `jouzu.cli.fast.usage`: `/fast`、`/fast on`、または `/fast off` → `` `/fast`、`/fast on`、または `/fast off` ``
  * `jouzu.cli.flow.resetBusy`: `/flow reset confirm` → `` `/flow reset confirm` ``
  * `jouzu.cli.flow.resetConfirm`: `/flow clear` and `/flow reset confirm` → `` `/flow clear` `` and `` `/flow reset confirm` `` *(note: `runtime-localization.test.mjs` L57–58 tests `/まず \/flow clear/u` and `/\/flow reset confirm/u`)*
  * `jouzu.cli.flow.resetRecovery`: `/flow` → `` `/flow` ``

### D. Architectural Fix for Cross-Message Sentence Fragments (`help.footer.line1..7` & `help.textguard.line1..4`)

* **Affected IDs:**
  * `jouzu.cli.help.footer.line1` through `jouzu.cli.help.footer.line7` (7 numbered messages)
  * `jouzu.cli.help.textguard.line1` through `jouzu.cli.help.textguard.line4` (4 numbered messages)
* **Issue:** In English, single sentences are split mid-clause across numbered message IDs to match fixed 80-column display lines (for example, `line5` ends with *"Open the Jouzu Palette"* and `line6` starts with *"through /model or Ctrl+L"*). Because Japanese word order is SOV, the Japanese translator had to move clauses across message boundaries (`line4` in Japanese contains the `JOUZU_NO_CLEAR=1` sentence from English `line5` and starts the `/model` clause from English `line6`, while `line7` drops the `Shift+Tab` clause because it was moved into `line6`).
* **Recommendation:** Replace the 7 physical `footer.line1..7` messages (and 4 `textguard.line1..4` messages) with **complete, self-contained messages grouped by topic** (1. alias and session recovery, 2. first-launch profile and viewport behavior, 3. Palette navigation and Pi CLI help), and let the terminal width renderer (`wrapHumanText`) wrap each topic at 48, 80, and 120 columns.

---

## 9. Deeper Structural and Runtime Composition Bugs (Found via Call-Site Audit)

Looking at *why* the commentary caught items like cross-message fragments and missing backticks, we audited **how TypeScript callers in `packages/cli/src/` actually assemble, interpolate, and concatenate these Fluent strings at runtime**. That uncovered 8 structural defects that are invisible when reading `catalogs.csv` one row at a time:

### A. `countLabel()` Concatenation in `jouzu.cli.settings.savedWithCount` Produces Broken Hybrid Japanese

* **`countLabel(count)` (`packages/cli/src/catalog-settings.ts` L177 & L730):**
  * **Affected ID:** `jouzu.cli.settings.savedWithCount` (`{ $label } を { $count } 付きで保存しました。`)
  * **How it works:** `countLabel(count)` is hardcoded in English as `` `${count} model${count === 1 ? "" : "s"}` `` and is also rendered directly as the row metadata in Settings / Catalogs (`catalog-settings.ts` L2714).
  * **Runtime result:** When saving a catalog in Japanese, the user sees:
    `Shisa API を 5 models 付きで保存しました。` ("Saved Shisa API with 5 models attached" — both untranslated English `5 models` and unnatural `付きで`!).
  * **Fix:** Pass `$count` as a numeric value into a Fluent select expression in `en/cli.ftl` (`Saved { $label } with { $count -> [one] { $count } model *[other] { $count } models }.`) and format `ja/cli.ftl` as `{ $label }（モデル { $count } 件）を保存しました。` (and localize `countLabel` on L2714).
* **`jouzu.cli.textguard.otherView.reports` (`packages/cli/src/textguard-review.ts` L425 & L743):**
  * **Affected ID:** `jouzu.cli.textguard.otherView.reports` (`件の検出は何も妨げませんでした · { $command }`)
  * **How it works:** The caller renders `${deps.otherView.count} ${deps.otherView.hint}` outside Fluent.
  * **Fix without breaking caller:** Use `件の検出は内容をブロックしませんでした · { $command }` so `${count} 件の` attaches directly to `検出` (`3 件の検出は内容をブロックしませんでした · /textguard reports`) rather than `内容`, while requiring zero caller changes and leaving `otherView.decisions` (`件の項目が判断待ち · { $command }`) intact.

### B. Double Punctuation and Mismatched Separators from String Concatenation

1. **Double Period `。。` in `jouzu.cli.textguard.alert.withheld` (`packages/cli/src/textguard-review.ts` L602–607):**
   * `jouzu.cli.textguard.alert.withheld` is: `TextGuard が { $source } を保留しました: { $detail }。{ $next }`
   * Notice that in English (`TextGuard withheld { $source }: { $detail }.{ $next }`), `{ $detail }` (`describeEvidenceForUser`, which comes from `jouzu.cli.textguard.detail.errors` etc.) does not end with a period, *except* when `evidence.status === "unavailable"`, or when `{ $next }` (`approveInteractive`: ` { $command } を実行して確認し、承認してください。`) is appended with a leading ASCII space!
   * Even worse, in `jouzu.cli.settings.savedWithNotes` (`packages/cli/src/catalog-settings.ts` L739–742):
     * `savedWithNotes` is `{ $base } { $notes }。`
     * `{ $base }` is `savedQuarantined` (`{ $label } を保存しました。カタログリビジョンは検疫されました: { $reasons }。`), `savedWithCount` (`{ $label } を { $count } 付きで保存しました。`), or `savedWithoutCheck` (`カタログを確認せずに { $label } を保存しました。`) — **all three already end with `。`!**
     * Then `notes` are joined with English `". "` (`notes.join(". ")`) and followed by `。` at the end of `savedWithNotes`!
     * **Runtime result:** `{ $label } を保存しました。 トークン変数 FOO が設定されておらず...更新してください. 警告...。` (ASCII space after `。` and ASCII `. ` between Japanese sentences).
2. **Untranslated English `{ $stage }` Interpolated into Japanese `/flow` Status (`packages/cli/src/flow-control/flow-status-report.ts` L92):**
   * `jouzu.cli.flow.status.requestEndedDuring`: `{ $stage } の途中でリクエストが終了しました。ペイロードは受け付けられませんでした。`
   * `jouzu.cli.flow.status.requiredContextRemovedDuring`: `必要なコンテキストが { $stage } 中に削除または変更されました。`
   * `jouzu.cli.flow.status.requiredInputRemovedDuring`: `必要な入力が { $stage } 中に削除または変更されました。`
   * Although the catalog defines `jouzu.cli.flow.stage.contextPreparation` (`コンテキストの準備`), `modelConversion` (`モデル変換`), and `stageRequestPreparation` (`リクエストの準備`), `flow-status-report.ts` L92 passes raw `source.stage` (`"context preparation"`) directly without looking up the catalog ID! (Even `flow-readable-status.test.mjs` L472 asserts `/必要な入力が context preparation 中に削除または変更されました。/`.)
3. **English Semicolons (`; `) and ASCII Parens Mixed Into Japanese Diagnostics:**
   * `jouzu.cli.keybindings.action.conflictDetail` (`; { $action } と競合`) and `action.currentDetail` (`; 設定値 { $binding }`) use an English semicolon `; ` inside parentheses, whereas `jouzu.cli.doctor.problem.extensionsDisabledTools` translates `; disabled tools: { $tools }` as `、無効化されたツール: { $tools }`.
   * 14 entries in `ja/cli.ftl` use half-width ASCII parentheses `(...)` (e.g., `モデルカタログの操作が実行中です ({ $status })`, `エージェントの要求でコンテキストを圧縮しました (pi-vcc 要約)`), while 56 entries use full-width `（...）` (`カタログの認証に失敗しました（HTTP { $status }）`).

### C. Omitted Referents and Ambiguous Pronouns in Japanese

1. **Omitted Subject in `jouzu.cli.settings.credential.availability` (`[saved]` and `*[unset]` branches):**
   * **EN:** `{ $name } { $state -> [set] is set in this Jouzu process. [saved] is not set; the saved token will be used in this Jouzu process. *[unset] is not set in this Jouzu process. }`
   * **JA:** `{ $name } { $state -> [set] はこの Jouzu プロセスで設定されています。 [saved] は設定されていません。保存されたトークンが使用されます。 *[unset] は設定されていません。 }`
   * **Issue:** The `[saved]` and `*[unset]` branches in Japanese drop `この Jouzu プロセスで` (*"in this Jouzu process"*), which is the key diagnostic distinction (the environment variable is not set in the current process environment, even if the user just added it to `~/.zshrc`).
2. **Omitted `Jouzu` in `jouzu.cli.language.choice.skipped`:**
   * **EN:** *"No language chosen. Jouzu will ask again next time."*
   * **JA:** `言語は選択されませんでした。次回も確認します。` (omits `Jouzu は`, whereas both Chinese drafts preserve `Jouzu`).
3. **Ambiguous "This" in `jouzu.cli.catalogSource.reservedId`:**
   * **EN:** *"source id "{ $id }" is reserved for the built-in Shisa API catalog ({ $url }, env:{ $env }); this entry points elsewhere, so the built-in source stays inactive"*
   * **JA:** `ソース ID "{ $id }" は組み込みの Shisa API カタログ（{ $url }、env:{ $env }）用に予約されています。この登録は別の場所を指すため、組み込みソースは無効のままです`
   * **Issue:** `この登録` ("this registration") is vague compared to `この項目` or `この設定項目` ("this configured entry").

### D. Remaining Unlocalized User-Facing Strings in `packages/cli/src/` (Outside `catalogs.csv` and `direct-strings.csv`)

While checking how `catalogs.csv` is wired into the TypeScript source, we also found user-facing TUI/CLI strings in `packages/cli/src/` that were never extracted into `cli.ftl` (and are not in `direct-strings.csv` because `check-direct-strings.mjs` only checks 13 specific AST shapes):

* **`packages/cli/src/catalog-settings.ts` (L189–192 & L2077–2121):**
  * Form help lines in Settings / Catalogs are hardcoded in English:
    * *"Enter the variable name, not the token. Set it before launching Jouzu, for example with export NAME=… in ~/.bashrc or ~/.zshrc. The environment value is never saved."*
    * *"Optional: enter a token to save it in Jouzu's private credential store. The variable takes precedence when set."*
    * *"A token is saved for this source; leave this empty to keep it, or enter a new one to replace it."*
    * *"Warning: ${credentialName} is set and takes precedence over the saved token."*
  * Source status column in Settings / Catalogs: `"reserved-id conflict"`, `"disabled"`, `"${status.credentialName} not set"`.
* **`packages/cli/src/scrollback.ts` (L289–546):**
  * While the scrollback title and error notices are in `runtime.ftl`, the header and markers inside the exported scrollback view are hardcoded in English (`"Scope: stored entries on the active branch..."`, `"Limits: system prompts, tool details..."`, `"No transcript content is stored on this branch yet."`, `"Press Enter, Escape, or Ctrl+C to return to Jouzu."`, `"[redacted thinking]"`, `"[response truncated]"`).
* **`packages/cli/src/flow-control/flow-status-extension.ts` & `flow-message-renderer.ts`:**
  * Several `/flow` command responses and help lines in `flow-status-extension.ts` (L34–58, L186–204, L241–292, L329–452) and `flow-message-renderer.ts` (`"+${hidden} more results"`, `"notification only — no reply owed"`) remain hardcoded in English while adjacent lines in the same function use `catalogText(catalog, ...)`.
* **`packages/cli/src/model-picker.ts` (L189–199):**
  * `"Compaction completed, but the active context still does not fit..."` and `"Compaction failed: ..."` are hardcoded in English.

### E. Exact Test Assertions That Pin Current Japanese Strings

Changing the following terms in `packages/cli/locales/ja/*.ftl` will require updating corresponding test assertions and regenerating `packages/cli/locales/catalog.lock.json` (`node scripts/catalog-digest.mjs`):

| Term / String | Test File(s) Asserting the Current Japanese Text |
| :--- | :--- |
| `提供 { $total } 件...` / `モデルの提供は破棄される` (*offerings*) | `packages/cli/test/catalog-command.test.mjs` (L170, L172)<br>`packages/cli/test/doctor.test.mjs` (L905, L906) |
| `検疫されています` (*quarantined*) | `packages/cli/test/catalog-command.test.mjs` (L173) |
| `内容の指紋（SHA-256）` (*content fingerprint*) | `packages/cli/test/textguard-review.test.mjs` (L520) |
| `保留` / `保留中` (*withheld* in TextGuard) | `packages/cli/test/textguard-review.test.mjs` (L532, L533, L538) |
| `別のアタッチメントが所有しています` (*attachment*) | `packages/cli/test/flow-locale-wiring.test.mjs` (L205) |
| `省略可能な日本語サポートプロファイル` / `省略可能な拡張機能` (*optional*) | `packages/cli/test/profile-choice.test.mjs` (L72)<br>`packages/cli/test/release-extensions.test.mjs` (L320) |
| `サポートされていない UI 言語です` (*UI locale*) | `packages/cli/test/ui-locale.test.mjs` (L661) |
| `スコープ内のモデル` (*scoped models*) | `packages/cli/test/presentation.test.mjs` (L406) |
| `URL を取得` / `ウェブを検索` / `親コンテキスト` / `子エージェント` (*tool labels*) | `packages/cli/test/camoufox-adapter.test.mjs` (L34–35)<br>`packages/cli/test/subagent-context.test.mjs` (L223)<br>`packages/cli/test/subagent-integration.test.mjs` (L40) |
| `bearer トークン` *(in Palette golden snapshot)* | `packages/cli/test/palette-golden.test.mjs` (L123, L134, L145 — note: the 4 missing-space `がbearer トークン` strings in `catalog.discovery.*` are **not** pinned by any test) |
| `` `状態とコマンドを確認するには /labels を使用してください。` `` (*backticks*) | `packages/cli/test/session-label-locale.test.mjs` (L78) |
| `言語設定は通常のファイルでなければなりません` (*regular file*) | `packages/cli/test/ui-locale.test.mjs` (L693) |
| `コンテキストポリシーはサイズ上限のある通常ファイルでなければなりません` (*bounded regular file*) | `packages/cli/test/context-clamp.test.mjs` (L145) |
| `{ $tokens }/{ $window } トークン ({ $percent }%)` (*full-width parens*) | `packages/cli/test/presentation.test.mjs` (L405) |
| `音声には Shisa のログインまたは SHISA_API_KEY が必要です。` (*sign-in*) | `packages/cli/test/voice.test.mjs` (L301) |

---

## 10. Reviewer Subagent Audit & Adjudication (`proposed-changes.csv`)

The 221-row manifest in [`review/ja-localization/proposed-changes.csv`](proposed-changes.csv) was audited by a `reviewer` subagent (`gemini-4-argon`, run `a900fb9c-9429-476a-8a6c-5a89946633fa`) against all 1,576 rows of `catalogs.csv` and the 5 reference `.ftl` files.

### A. Reviewer Catches Accepted and Applied to `proposed-changes.csv`

1. **Syntactic Counter Attachment in `jouzu.cli.textguard.otherView.reports`:**
   * Writing `件の内容をブロックしなかった検出` after `${count} ` makes `${count} 件の` modify `内容` ("`$count` pieces of content") instead of `検出` ("`$count` findings").
   * **Resolution:** Changed `ja_proposed` to **`件の検出は内容をブロックしませんでした · { $command }`**, which keeps `${count} 件の` attached directly to `検出` (`3 件の検出は内容をブロックしませんでした · /textguard reports`), matches `otherView.decisions` (`件の項目が判断待ち · { $command }`), and requires zero changes to `textguard-review.ts`.
2. **Line-End Opening Parenthesis (`行末禁則`) and 8 No-Op Rows in `help.footer.line*` / `help.textguard.line*`:**
   * Ending `help.footer.line2` with `確認します（` and starting `line3` with `Core が安全なフォールバックです）。` violated Japanese line-breaking rules (`行末禁則`) when `help.ts` joins `line1..7` with `\n`.
   * **Resolution:** Kept `help.footer.line1` and `line2` as self-contained sentences on their respective lines and removed the 8 no-op `line*` rows (`ja_proposed == ja_current`) from `proposed-changes.csv`.
3. **Repetitive `提供` in `jouzu.cli.catalog.registrationEffect`:**
   * `Pi がまだ提供していない提供モデルは破棄されるため...` repeated `提供` back-to-back.
   * **Resolution:** Updated to `Pi に未登録のモデルの提供モデルは破棄されるため、そのモデルがモデル一覧に到達することはありません。`
4. **English Select Expression for `jouzu.cli.settings.savedWithCount` & Trailing `。` for `settings.note.*`:**
   * Populated `en_proposed` on `savedWithCount` (`Saved { $label } with { $count -> [one] { $count } model *[other] { $count } models }.`) so passing numeric `count` works in both English and Japanese, and added `jouzu.cli.settings.note.tokenNotSet` and `jouzu.cli.settings.note.tokenPrecedence` with trailing `。` to pair with `savedWithNotes`.
5. **8 Additional Outliers Caught Across `catalogs.csv`:**
   * `jouzu.cli.help.command.catalog`: `省略可能なカタログ設定` → `任意のカタログ設定`
   * `jouzu.cli.localization.config.notRegularFile`: `通常のファイル` → `通常ファイル` (matching `projectPolicy.notRegularFile` and 10 other entries)
   * `jouzu.cli.context.policy.notBoundedFile`: `サイズ上限のある通常ファイル` → `サイズ制限のある通常ファイル` (matching `catalogSource.*`)
   * `jouzu.cli.classicHost.mcpUnavailable`: `(MCP)` → `（MCP）` and `Web ツール` → `ウェブツール` (matching `ウェブを検索`, `ウェブ内容`, `ウェブ結果`)
   * `jouzu.cli.subagent.messageAccepted`: `コントローラーに受理されました` → `コントローラーに受け付けられました`
   * `jouzu.cli.subagent.contextSpliceIds`: `コンパクションのエントリ ID` → `圧縮のエントリ ID` (the lone entry in the catalog that transliterated `compaction` as `コンパクション`)
   * `jouzu.cli.presentation.status.runtime` & `jouzu.cli.doctor.surfaceRecheck`: `ランタイム` → `実行環境` (matching `runtime.summary` and 15 other entries)

### B. Reviewer Suggestions Rejected (Where Existing Japanese Is Better)

1. **`jouzu.cli.report.problem(s)` / `warning(s)` & `jouzu.cli.catalog.problem(s)` / `warning(s)` (8 rows — Keep `件の問題` / `件の警告`):**
   * **Why rejected:** `doctor.ts` and `catalog-command.ts` call `pluralize(count, singular, plural)` (`${count} ${singular}`), which renders `✓ 0 件の問題 · ✓ 0 件の警告`. Because `ja/cli.ftl` puts a half-width space around ASCII numbers everywhere (`{ $count } 件のエラー`, `{ $count } 件の候補リビジョン`), `0 件の問題` already matches the exact spacing and grammar (`N 件のX`) of the rest of the catalog—and adding `{ $count }` would fail `scripts/check-locales.mjs` (Rule 4: placeholder parity with `en`) unless all 4 locales and 3 TypeScript files were rewritten.
2. **`jouzu.cli.textguard.list.progress` (`({ $current }/{ $total })` — Keep Half-Width Parentheses):**
   * **Why rejected:** Unlike `detail.progress` (`（全 { $total } 行中 { $start }〜{ $end } 行）`), `({ $current }/{ $total })` is a pure numeric fraction `(1/5)` with no Japanese characters inside (`ja_same_as_en = true` across all 4 locales). Half-width parentheses are standard for pure numeric counters and save 2 columns in narrow TUI views.
3. **`jouzu.cli.modelPicker.switchQueued` & `queuedSwitchFailed` (2 rows — Keep `予約しました` / `予約した`):**
   * **Why rejected:** In the Session Dashboard, the bare section heading `Scheduled` (`jouzu.cli.session.dashboard.section.prompt`) sits next to `Flow` and collides with flow-control `reservation` (`予約`), so changing that heading to `スケジュール済み` is warranted. By contrast, in the Model Picker notification *"Model switch queued for the next model call"*, `モデルの切り替えを次のモデル呼び出しに予約しました` is a complete sentence with an explicit direct object (`モデルの切り替えを`), where `予約しました` is natural Japanese and far clearer than the reviewer's `待機中にしました`.
4. **The 9 Negative `"not refreshed"` Strings in `jouzu.cli.modelPicker.*` (Keep `再取得できませんでした`):**
   * **Why rejected:** We changed the 8 positive/active strings (`Model catalog refreshed` → `モデルカタログを更新しました`) because `取得しました` (without `再`) sounded like a first-time download rather than a refresh. By contrast, in the 9 cache-fallback notices (*"Catalogs not refreshed: { $sources }. Cached catalog data remains available."* → `カタログを再取得できませんでした: { $sources }。キャッシュされたカタログデータは引き続き利用できます。`), `再取得できませんでした` ("could not re-fetch; cached data remains available") is more accurate than `更新できませんでした` (which in `Settings / Catalogs` sounds like saving/modifying a catalog failed).
