# Settings から言語設定を適用・リセットするためのメッセージ。
#
# このファイルは `ja` ロケールの 2 つ目のカタログ名前空間です。ローダーは
# ロケールディレクトリ内のすべての `*.ftl` を読むため、並行するレーンは
# `cli.ftl` を編集せずに自分のファイルを追加できます。ID はカタログ専用で、
# `CatalogMessageId` には登録しません。`scripts/check-locales.mjs` は `en` と
# `ja` が同じ ID 集合を持つことを要求します。

jouzu-cli-localization-settings-confirm-heading = 言語の変更を保存
jouzu-cli-localization-settings-reset-heading = 言語設定をリセット
jouzu-cli-localization-settings-recovery = 書き込み前に以前の設定をバックアップし、リセットで保存された表示言語を自動に戻せます。
jouzu-cli-localization-settings-reset-confirm = 保存された表示言語を自動に戻し、このセッションの言語上書きを消去しますか？保存された応答言語と成果物の設定は保持します。現在の設定は先にバックアップします。
jouzu-cli-localization-settings-no-change = 適用する前に ←/→ で別の値を選んでください。
jouzu-cli-localization-settings-change = { $from } → { $to }
jouzu-cli-localization-settings-applied = 将来のセッション用に保存しました。バックアップ: { $backup }。トランザクション: { $transaction }。
jouzu-cli-localization-settings-applied-no-backup = 将来のセッション用に保存しました。バックアップは不要でした。トランザクション: { $transaction }。
jouzu-cli-localization-settings-reset-done = 保存された表示言語を自動に戻しました。保存された応答言語と成果物の設定は保持しました。バックアップ: { $backup }。トランザクション: { $transaction }。
jouzu-cli-localization-settings-reset-done-no-backup = 保存された表示言語を自動に戻しました。保存された応答言語と成果物の設定は保持しました。バックアップは不要でした。トランザクション: { $transaction }。
jouzu-cli-localization-settings-saved-restart = 更新に対応する Jouzu の画面はすぐに切り替わります。残りの画面は Jouzu を再起動すると更新されます。
jouzu-cli-localization-settings-notices = 保存された変更を他のセッションに通知しました: { $count }。
jouzu-cli-localization-settings-apply-failed = 言語の変更を保存できませんでした: { $message }
jouzu-cli-localization-settings-reset-failed = リセットを保存できませんでした: { $message }
jouzu-cli-localization-settings-hint-apply = 適用
jouzu-cli-localization-settings-hint-reset = リセット
