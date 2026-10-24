# Settings から言語設定を適用・リセットするためのメッセージ。
#
# このファイルは `ja` ロケールの 2 つ目のカタログ名前空間です。ローダーは
# ロケールディレクトリ内のすべての `*.ftl` を読むため、並行するレーンは
# `cli.ftl` を編集せずに自分のファイルを追加できます。ID はカタログ専用で、
# `CatalogMessageId` には登録しません。`scripts/check-locales.mjs` は `en` と
# `ja` が同じ ID 集合を持つことを要求します。

jouzu-cli-localization-settings-confirm-heading = 言語の変更を適用
jouzu-cli-localization-settings-reset-heading = 言語設定をリセット
jouzu-cli-localization-settings-scope = 適用範囲
jouzu-cli-localization-settings-scope-session = このセッションだけ
jouzu-cli-localization-settings-scope-environment = 保存された設定
jouzu-cli-localization-settings-recovery = 書き込み前に以前の設定をバックアップし、リセットで既定値に戻せます。
jouzu-cli-localization-settings-reset-confirm = すべての言語設定を既定値に戻しますか？現在の設定は先にバックアップします。
jouzu-cli-localization-settings-no-change = 適用する前に ←/→ で別の値を選んでください。
jouzu-cli-localization-settings-change = { $from } → { $to }
jouzu-cli-localization-settings-applied = { $scope }に適用しました。バックアップ: { $backup }。トランザクション: { $transaction }。
jouzu-cli-localization-settings-applied-no-backup = { $scope }に適用しました。バックアップは不要でした。トランザクション: { $transaction }。
jouzu-cli-localization-settings-reset-done = 既定値に戻しました。バックアップ: { $backup }。トランザクション: { $transaction }。
jouzu-cli-localization-settings-reset-done-no-backup = 既定値に戻しました。バックアップは不要でした。トランザクション: { $transaction }。
jouzu-cli-localization-settings-notices = 保存された変更を他のセッションに通知しました: { $count }。
jouzu-cli-localization-settings-apply-failed = 言語の変更を保存できませんでした: { $message }
jouzu-cli-localization-settings-reset-failed = リセットを保存できませんでした: { $message }
jouzu-cli-localization-settings-hint-apply = 適用
jouzu-cli-localization-settings-hint-scope = 適用範囲
jouzu-cli-localization-settings-hint-reset = リセット
