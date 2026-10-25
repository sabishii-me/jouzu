# Messages for the `profile-migration` CLI entry.
#
# This file is a second catalog namespace for the `zh-Hant` locale. The loader
# reads every `*.ftl` file in a locale directory, so a parallel lane can add its
# own file without editing `cli.ftl`. The IDs are catalog-only, except the two
# `jouzu.cli.args.*` argument errors, which the hand-maintained `CliMessageId`
# table also names. `scripts/check-locales.mjs` requires the same set in every
# catalog.

jouzu-cli-profileMigrationCommand-applied = 已套用設定檔移轉交易: { $id }
jouzu-cli-profileMigrationCommand-alreadyApplied = 不需要變更；此移轉已套用。
jouzu-cli-profileMigrationCommand-willSave = 確認此計畫會將其儲存至使用者全域設定。
jouzu-cli-profileMigrationCommand-changedTargets = 已變更的檔案: { $targets }
jouzu-cli-profileMigrationCommand-temporaryNotSaved = 設定檔選擇是暫時的；未寫入使用者全域設定。
jouzu-cli-profileMigrationCommand-confirm = 要套用此移轉嗎？[y/N]
jouzu-cli-profileMigrationCommand-confirmationRequired = 此執行不是互動式，因此未寫入任何內容。請以 --yes 重新執行以確認移轉。
jouzu-cli-profileMigrationCommand-cancelled = 已取消；未寫入任何內容。
jouzu-cli-profileMigrationCommand-conflict = 計畫含有衝突，因此未寫入任何內容。
jouzu-cli-profileMigrationCommand-rolledBack = 已復原設定檔移轉交易: { $id }
jouzu-cli-profileMigrationCommand-rollbackUnchanged = 已記錄的移轉沒有可還原的內容。
jouzu-cli-profileMigrationCommand-nothingToRollback = 沒有已記錄的設定檔移轉可復原。
jouzu-cli-profileMigrationCommand-receiptUnreadable = 無法讀取已記錄的設定檔移轉。
jouzu-cli-args-profileMigrationOperationRequired = profile-migration 需要 "plan"、"apply" 或 "rollback"
jouzu-cli-args-profileMigrationUnknownOption = 不明的 profile-migration { $operation } 選項: { $token }
