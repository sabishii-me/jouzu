# `profile-migration` CLI 入口のメッセージ。
#
# このファイルは `ja` ロケールの 2 つ目のカタログ名前空間です。ローダーは
# ロケールディレクトリ内のすべての `*.ftl` を読むため、並行作業のレーンは
# `cli.ftl` を編集せずに専用ファイルを追加できます。ID はカタログ専用ですが、
# 2 つの `jouzu.cli.args.*` 引数エラーは手管理の `CliMessageId` テーブルにも
# 現れます。`scripts/check-locales.mjs` は `en` と `ja` に同じ集合を要求します。

jouzu-cli-profileMigrationCommand-applied = プロファイル移行トランザクションを適用しました: { $id }
jouzu-cli-profileMigrationCommand-alreadyApplied = 変更は不要でした。移行はすでに適用されています。
jouzu-cli-profileMigrationCommand-willSave = このプランを確定すると、ユーザー全体の設定へ保存されます。
jouzu-cli-profileMigrationCommand-changedTargets = 変更したファイル: { $targets }
jouzu-cli-profileMigrationCommand-temporaryNotSaved = プロファイルの選択は一時的なため、ユーザー全体の設定は書き換えていません。
jouzu-cli-profileMigrationCommand-confirm = この移行を適用しますか？ [y/N]
jouzu-cli-profileMigrationCommand-confirmationRequired = この実行は対話的ではないため、何も書き込みませんでした。移行を確定するには --yes を付けて再実行してください。
jouzu-cli-profileMigrationCommand-cancelled = 取り消しました。何も書き込んでいません。
jouzu-cli-profileMigrationCommand-conflict = プランに競合があるため、何も書き込んでいません。
jouzu-cli-profileMigrationCommand-rolledBack = プロファイル移行トランザクションをロールバックしました: { $id }
jouzu-cli-profileMigrationCommand-rollbackUnchanged = 記録された移行に復元対象はありませんでした。
jouzu-cli-profileMigrationCommand-nothingToRollback = ロールバックできるプロファイル移行の記録がありません。
jouzu-cli-profileMigrationCommand-receiptUnreadable = 記録されたプロファイル移行を読み取れませんでした。
jouzu-cli-args-profileMigrationOperationRequired = profile-migration には "plan"、"apply"、"rollback" のいずれかが必要です
jouzu-cli-args-profileMigrationUnknownOption = profile-migration の { $operation } に不明なオプションがあります: { $token }
