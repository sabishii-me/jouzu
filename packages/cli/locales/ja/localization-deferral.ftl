# 実行中の作業がある間に言語変更を延期するためのメッセージ。
#
# このファイルは `ja` ロケールの 2 つ目のカタログ名前空間です。ローダーは
# ロケールディレクトリ内のすべての `*.ftl` を読むため、並行するレーンは
# `cli.ftl` を編集せずに自分のファイルを追加できます。ID はカタログ専用で、
# `CatalogMessageId` には登録しません。`scripts/check-locales.mjs` は `en` と
# `ja` が同じ ID 集合を持つことを要求します。

jouzu-cli-localization-deferral-ime = 変換中の文字を確定するまで、言語の変更は待ちます。
jouzu-cli-localization-deferral-confirmation = 画面の確認に答えるまで、言語の変更は待ちます。
jouzu-cli-localization-deferral-streaming = 回答のストリーミングが終わるまで、言語の変更は待ちます。
jouzu-cli-localization-deferral-tool = 実行中のツールが終わるまで、言語の変更は待ちます。
jouzu-cli-localization-deferral-update = 更新が終わるまで、言語の変更は待ちます。
jouzu-cli-localization-deferral-notice = 言語の変更を延期しました: { $reason }
jouzu-cli-localization-deferral-fixed = 確認が開いている間は表示言語を固定します。
jouzu-cli-localization-deferral-reapproval = 言語を変えても確認の承認にはなりません。{ $confirm } で承認し、{ $cancel } で取り消してください。
jouzu-cli-localization-deferral-upstream = Jouzu が管理しない画面は現在の言語のままです。次に開いたとき、または再起動後に切り替わります。
