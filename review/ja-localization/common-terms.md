# Common English Technical and Repository-Specific Terms (`catalogs.csv`)

This is a historical snapshot of source `2884de8`, not the current catalog. Counts and wording below have not been recomputed. Use the [current inventory](README.md) and [current glossary](../../docs/localization-glossary.md) when reviewing a new candidate.

Source inventory: [`review/ja-localization/catalogs.csv`](https://github.com/shisa-ai/jouzu/blob/46fa16a84621afaa3226e9b17e30cb93911a0e79/review/ja-localization/catalogs.csv) (1,576 Fluent message entries across `cli.ftl`, `runtime.ftl`, `localization-settings.ftl`, `profile-migration-command.ftl`, and `localization-deferral.ftl`).

Untranslated identifiers—such as product/brand names (`Jouzu`, `Shisa`, `Pi`, `Camoufox`, `TextGuard`), CLI subcommands and flags, JSON keys, and Fluent `{ $variables }`—are excluded, except where an English term is translated in prose and kept in English as a UI view name.

---

## 1. Catalogs, Models, and Offerings (Repository-Specific)

| English Term | Occurrences | Japanese Translation(s) | Usage and Variants |
| :--- | :---: | :--- | :--- |
| **catalog** | 133 | `カタログ` (117)<br>*(UI view: `Catalogs`)* | `カタログ` in prose and diagnostics; kept as `Catalogs` when naming the `Settings / Catalogs` UI tab. |
| **model** | 118 | `モデル` (101)<br>*(UI view: `Models`)* | `モデル` in general; kept as `Models` when naming the Palette section. |
| **catalog source** | 33 | `カタログソース` (33) | Consistent across all entries. |
| **refresh** *(catalog / models)* | 26 | `取得` (17) / `再取得` (9) / `更新` (8) | **Variant:** "Model catalog refresh" appears as both `モデルカタログの取得` and `モデルカタログの更新`; "not refreshed" uses `再取得できませんでした`. |
| **model catalog** | 16 | `モデルカタログ` (16) | Consistent. |
| **offering(s)** *(catalog offerings)* | 12 | `提供` (12) / `提供数` (field label) | `{ $offerings } offerings` → `提供 { $offerings } 件`; "No cached model offerings" → `キャッシュされた提供がありません`. |
| **catalog source override(s)** | 7 | `カタログソースの上書き設定` (4)<br>`カタログソースの上書き` (3) | Used for local source override files and entries. |
| **favorite model(s)** / **favorites** | 7 | `お気に入りモデル` (7) / `お気に入り` | Consistent. |
| **thinking level(s)** | 6 | `思考レベル` (6) | Consistent. |
| **revision** *(catalog / role revision)* | 6 | `リビジョン` (5) | Consistent. |
| **fast mode** | 5 | `高速モード` (5) | Consistent. |
| **catalog source registry** | 4 | `カタログソース登録` (4) | Consistent. |
| **model picker** | 4 | `モデルピッカー` (4) | `モデルピッカー状態` (*Model picker state*), `モデルピッカーロック` (*Model picker lock*). |
| **digest** / **content fingerprint** | 4 | `ダイジェスト` (2) / `内容の指紋` (1) | `UI catalog digest` → `UI カタログダイジェスト`; `Content fingerprint` → `内容の指紋`. |
| **quarantine / quarantined** | 3 | `検疫` (3) | `候補リビジョンが検疫されています` (*candidate revisions are quarantined*). |
| **reasoning effort** | 2 | `推論の強度` (2) | Consistent. |

---

## 2. Flow Control, Turns, and Execution (Repository-Specific)

| English Term | Occurrences | Japanese Translation(s) | Usage and Variants |
| :--- | :---: | :--- | :--- |
| **flow** / **flow control** | 48 | `フロー制御` (11) / `フロー` (22) | `Flow clear...` and `Flow control...` map to `フロー制御` or `フロー`. |
| **wait(s)** / **waiting** | 32 | `待機` (13) / `待っています`・`待つ` (17) | Noun forms ("live waits", "wait decision") use `待機` (`有効な待機`, `待機決定`). |
| **hold(s)** / **held** | 16 | `保留` (14) / `保持` (7) | `request hold(s)` → `リクエストの保留`; `Pending work is held` → `保留中の処理はそのまま保持されます`. |
| **compaction** / **compact** | 14 | `圧縮` (12) / `コンパクション` (1) | **Variant:** `圧縮` (`コンテキストを圧縮`) in 12 entries; `compaction entry IDs` → `コンパクションのエントリ ID` in 1 entry. |
| **turn(s)** / **automated turn(s)** | 12 | `ターン` (11) / `自動ターン` (4) | Consistent. |
| **pause / paused** | 10 | `一時停止` (10) | Consistent. |
| **admission** / **payload admission** | 9 | `受理` (7) — `ペイロード受理` (2), `セマンティック受理`, `受理ポリシー`<br>`受け付け` (2) — `ペイロードの受け付け` (1) | **Variant:** "before payload admission" appears as `ペイロード受理の前に` in some entries and `ペイロードの受け付け前に` in others. |
| **recovery** | 8 | `復旧` (8) | `復旧オプション` (*recovery options*), `復旧の再調整` (*recovery reconciliation*). |
| **receipt** / **receipt evidence** | 6 | `受領記録` (5) | Both `receipt` and `receipt evidence` translate to `受領記録`. |
| **automation** | 6 | `自動実行` (6) | `自動実行を再開` (*resume automation*). |
| **reservation** | 4 | `予約` (4) | `アクティブな予約を解除` (*released the active reservation*). |
| **reconciliation** | 3 | `再調整` (3) | `復旧の再調整` (*recovery reconciliation*), `削除の再調整` (*removal reconciliation*). |
| **goal** *(multiloop)* | 2 | `ゴール` (2) | `切り離されたゴールの再開通知` (*Resume notice for a detached goal*). |
| **handoff** | 1 | `引き渡し` (1) | `未送信の引き渡し` (*Unsent handoff*). |
| **idle boundary** | 1 | `アイドル境界` (1) | `次のアイドル境界から実行` (*run from the next idle boundary*). |
| **lane** | 1 | `レーン` (1) | `ジョブ、タスク、レーン` (*Jobs, tasks, and lanes*). |

---

## 3. Agents, Subagents, and Workflow

| English Term | Occurrences | Japanese Translation(s) | Usage and Variants |
| :--- | :---: | :--- | :--- |
| **agent(s)** | 52 | `エージェント` (48) | `メインエージェント` (*main agent*), `エージェント定義` (*agent definition*). |
| **subagent(s)** | 30 | `子エージェント` (20)<br>`サブエージェント` (4) | **Variant:** `subagent(s)` translates to `子エージェント` in most sentences and `サブエージェント` in 4 entries (including `Subagent · { $operation }`). |
| **child** *(child agent / run / session)* | 21 | `子エージェント` (5) / `子セッション` (4) / `子の実行` (4) / `子` (10) | `child-capable role` → `子実行可能なロール`. |
| **task(s)** | 17 | `タスク` (16) | Consistent. |
| **dashboard** | 13 | `ダッシュボード` (13) | `子エージェントの実行ダッシュボード` (*Child run dashboard*). |
| **workflow** | 11 | `ワークフロー` (8)<br>*(UI view: `Workflow`)* | `ワークフロー` in general; kept as `Workflow` in 2 entries when naming the UI view. |
| **parent** *(session / context / branch / snapshot)* | 10 | `親セッション` / `親コンテキスト` / `親ブランチ` / `親のスナップショット` | Consistently uses `親...`. |
| **role(s)** | 10 | `ロール` (9) | Consistent. |
| **trace** | 10 | `トレース` (10) | Consistent. |
| **job(s)** | 7 | `ジョブ` (7) | Consistent. |
| **follow-up** | 4 | `追加指示` (3) / `フォローアップ` (1) | Subagent follow-ups use `追加指示`; keybinding field uses `フォローアップキー` (*follow-up key*). |
| **assignment** | 3 | `割り当て` (3) | Consistent. |

---

## 4. TextGuard and Content Security (Repository-Specific)

| English Term | Occurrences | Japanese Translation(s) | Usage and Variants |
| :--- | :---: | :--- | :--- |
| **content** | 43 | `内容` (41) | Consistently `内容` (not `コンテンツ`). |
| **scan / scanning** | 19 | `走査` (19) | Consistently `走査` (not `スキャン`). |
| **withheld / withhold** | 17 | `保留` (16) / `抑止` (1) | Usually `保留` (same word as `hold`); when paired with "held" in *"Nothing is held, withheld, waiting..."*, translated as `保留、抑止、待機...`. |
| **finding(s)** | 14 | `検出` (12) / `検出内容` (2) | `error-level finding` → `エラーレベルの検出`; `informational finding` → `情報レベルの検出`; `review findings` → `検出内容を確認` or `検出を確認`. |
| **flagged** | 10 | `フラグが付いた` (9) / `フラグを付けました` (1) | `flagged skills` → `フラグが付いたスキル`. |
| **untrusted data** | 5 | `信頼できないデータ` (5) | `labelled as untrusted data` → `信頼できないデータとしてラベル付けされて`. |
| **prompt injection** | 1 | `プロンプトインジェクション` (1) | Consistent. |

---

## 5. Sessions, Transcripts, Voice, and UI

| English Term | Occurrences | Japanese Translation(s) | Usage and Variants |
| :--- | :---: | :--- | :--- |
| **session(s)** | 82 | `セッション` (79) | `interactive session` → `対話セッション`. |
| **context** | 44 | `コンテキスト` (36) | `context window` → `コンテキストウィンドウ`; `context limit` → `コンテキスト上限`. |
| **voice** *(voice input)* | 40 | `音声` (36) / `音声入力` (3) | `Dictate into the prompt` → `プロンプトへ音声入力します`. |
| **keybinding(s)** / **shortcut(s)** | 29 | `キーバインド` (23) | `Keybinding defaults` → `キーバインド既定`; `user bindings` → `利用者のバインド`; `All shortcuts` → `すべてのキーバインド`. |
| **session label(s)** / **auto labels** | 16 | `セッションラベル` / `自動ラベル` / `ラベル` | `Automatic naming` → `自動命名`; `tmux pane` → `tmux ペイン`. |
| **transcript** / **transcript export** | 14 | `会話記録` (10) / `トランスクリプト` (2) / `記録` (1) / `文字起こし結果` (1) | **Context split:** UI scrollback export (`Transcript export`) uses `会話記録の出力`; flow state recovery uses `トランスクリプト`; voice ASR output uses `文字起こし結果`. |
| **interactive (terminal / TUI / session)** | 13 | `対話型端末` / `対話的な TUI モード` / `対話セッション` / `対話起動` | Consistently uses `対話...`. |
| **workspace** | 13 | `ワークスペース` (11) | Consistent. |
| **microphone** | 9 | `マイク` (9) | Consistent. |
| **prompt** | 7 | `プロンプト` (7) | Consistent. |
| **recording** *(voice)* | 6 | `録音` (6) | Consistent. |

---

## 6. Profiles, Localization, Runtime, and Self-Update

| English Term | Occurrences | Japanese Translation(s) | Usage and Variants |
| :--- | :---: | :--- | :--- |
| **profile(s)** | 57 | `プロファイル` (45) | `profile choice` → `プロファイルの選択`; `profile state` → `プロファイル状態`. |
| **language** *(UI / response / project / artifact)* | 44 | `言語` (42)<br>• `UI 言語` (*UI language / UI locale*)<br>• `回答言語` (*response language*)<br>• `プロジェクト言語` (*project language*)<br>• `成果物言語` (*artifact language*) | `display language` → `表示言語`. |
| **policy** | 29 | `ポリシー` (16) / `方針` (11) | **Variant:** `コンテキストポリシー`, `キーバインドポリシー`, `ネットワークポリシー` vs. `プロジェクト言語方針`, `成果物方針`. |
| **localization** / **localization settings** | 21 | `言語設定` (12) / `ローカライズ` (1) | `localization settings` translates to `言語設定`; the section heading `Localization` translates to `ローカライズ`. |
| **runtime** | 21 | `実行環境` (16) / `ランタイム` (2) | `Pi runtime` → `Pi 実行環境`; `Optional Camoufox runtime` → `省略可能な Camoufox 実行環境`. |
| **extension(s)** | 15 | `拡張機能` (8) / `同梱拡張` (2) | `Release-owned extensions` → `リリース所有の拡張機能` (or `リリース所有拡張機能`); `third-party bundled extensions` → `第三者の同梱拡張`. |
| **locale** / **canonical locale** | 13 | `ロケール` (6) / `正規ロケール` (2) / `UI 言語` (6) | **Variant:** `UI locale` translates to `UI 言語`, while `OS locale` and `canonical locale` use `OS ロケール` and `正規ロケール`. |
| **self-update** | 12 | `自己更新` (6)<br>*(CLI command: `self-update`)* | `Self-update channel` → `自己更新の導入方法`. |
| **transaction** | 9 | `トランザクション` (9) | Used in profile migration and localization settings commits. |
| **pinned (Pi / title)** | 8 | `固定版` / `固定した` / `固定` | `the pinned Pi` → `固定版の Pi`; `pinned Pi runtime` → `固定した Pi 実行環境`; `pinned` (pane label) → `固定`. |
| **skill(s)** | 8 | `スキル` (7) | `Package-owned skills` → `パッケージ所有のスキル`; `Shared cross-harness skills` → `共有クロスハーネススキル`. |
| **profile migration** | 6 | `プロファイル移行` (6) | Consistent. |
| **manifest** *(applied / bundled)* | 4 | `マニフェスト` (4) | `Applied profile manifest` → `適用済みプロファイルマニフェスト`; `bundled manifest` → `同梱マニフェスト`. |
| **fallback** | 3 | `フォールバック` (3) | Consistent. |
| **rollback / roll back** | 3 | `ロールバック` (2) | Consistent. |

---

## 7. Authentication, Network, Files, and General Operations

| English Term | Occurrences | Japanese Translation(s) | Usage and Variants |
| :--- | :---: | :--- | :--- |
| **check** | 47 | `確認` (43) / `検査` (1) | `確認してください` (*Check ...*) in 43 entries; `検査` in 1 entry (`/flow runtime checks`). |
| **state** / **status** | 39 / 37 | `状態` (38) / `ステータス` (6) | Both `state` and `status` predominantly map to `状態`. |
| **retry** | 37 | `再試行` (36) | Consistent. |
| **sign-in / login** | 36 | `サインイン` (24) / `ログイン` (3) / `再ログイン` (1) | **Variant:** Predominantly `サインイン`, while `Shisa login in use` uses `Shisa ログインを使用中` and one HTTP 401 message translates `Sign in again` as `再ログインするか`. |
| **cancel / cancellation** | 36 | `キャンセル` (26) / `取り消し`・`取り消され` (6) | Both `キャンセル` and `取り消す` appear. |
| **token** / **bearer token** | 36 | `トークン` (27) / `bearer トークン` (6) | `saved token` → `保存されたトークン` or `保存済みトークン`; `token variable` → `トークン変数`. |
| **apply / applied** | 35 | `適用` (27) / `適用済み` / `未適用` (*not applied*) | Consistent. |
| **settings** / **configuration** | 31 / 17 | `設定` (42) / `構成` (1) | Both `settings` and `configuration` map to `設定`. |
| **provider** | 23 | `プロバイダー` (18) | Consistent. |
| **review** | 23 | `レビュー` (15) / `確認` (8) | Code and subagent review use `レビュー`; TextGuard `review findings` uses `検出内容を確認`. |
| **approve / approval** | 20 | `承認` (20) | Consistent. |
| **reset** | 19 | `リセット` (15) / `既定値に戻す` (4) | Consistent. |
| **resume** | 19 | `再開` (14) / `解除` (3) | Releasing a pause with `/flow resume` uses `解除してください`. |
| **tool(s)** | 19 | `ツール` (17) | `browser tool` → `ブラウザーツール`. |
| **authentication / auth** | 18 | `認証` (16) | Consistent. |
| **credential(s)** | 17 | `資格情報` (17) | `environment credential reference` → `環境変数の資格情報参照`. |
| **plan** | 16 | `プラン` (4) / `計画` (3) | **Variant:** `Jouzu profile plan` → `Jouzu プロファイル計画`, whereas `Jouzu profile migration plan` → `Jouzu プロファイル移行プラン`. |
| **lock** | 15 | `ロック` (15) | `ロックファイル` (*lock file*). |
| **clear** | 14 | `解除` (9) / `消去` (1) / `クリア` (1) | Flow holds (`Flow clear`) use `解除`; viewport clear uses `消去`. |
| **environment variable(s)** | 12 | `環境変数` (5) / `変数` (12) | Consistent. |
| **regular file** / **bounded regular file** | 12 | `通常ファイル` (10) / `通常のファイル` (1)<br>`サイズ制限のある通常ファイル` (3) / `サイズ上限のある通常ファイル` (1) | **Variant:** `bounded regular file` uses `サイズ制限のある通常ファイル` in catalog strings and `サイズ上限のある通常ファイル` in context policy strings. |
| **sign-out / logout** | 12 | `サインアウト` (11) | Consistent. |
| **proxy** | 11 | `プロキシ` (11) | `proxy configuration` → `プロキシ設定`. |
| **cache / cached** | 10 | `キャッシュ` (10) / `キャッシュされた` | Consistent. |
| **diagnostics** | 10 | `診断` (4) | Consistent. |
| **endpoint** | 10 | `エンドポイント` (10) | Consistent. |
| **user** | 9 | `利用者` (9) / `ユーザー` (3) | `cli.ftl` uses `利用者` (9); `profile-migration-command.ftl` uses `ユーザー` (3). |

---

## 8. Non-Canonical, Odd, or Inconsistent Term Translations (Focus List)

This table isolates every term from the inventory whose Japanese rendering is non-canonical in developer tools, grammatically awkward as a noun, split across competing translations, or in conflict with [`docs/localization-glossary.md`](https://github.com/shisa-ai/jouzu/blob/2884de8cee8560810cfc29b235cd08c428469659/docs/localization-glossary.md).

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
| **that catalog requires bearer-token auth** *(spacing typo)* | `このカタログがbearer トークン認証` / `受け入れるbearer トークン` | `このカタログが bearer トークン認証` / `受け入れる bearer トークン` | Missing half-width space before `bearer` in 4 entries (`catalog.discovery.accessDenied`, `accessDeniedBearer`, `authFailed`, `authFailedBearer`), violating the half-width spacing used everywhere else in `cli.ftl`. |
