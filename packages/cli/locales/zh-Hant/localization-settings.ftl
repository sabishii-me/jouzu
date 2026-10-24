# Messages for applying and resetting the language settings from Settings.
#
# This file is a second catalog namespace for the `zh-Hant` locale. The loader
# reads every `*.ftl` file in a locale directory, so a parallel lane can add its
# own file without editing `cli.ftl`. The IDs are catalog-only: they have no
# entry in `CatalogMessageId`, and `scripts/check-locales.mjs` requires the same
# set in every catalog.

jouzu-cli-localization-settings-confirm-heading = 套用語言變更
jouzu-cli-localization-settings-reset-heading = 重設語言設定
jouzu-cli-localization-settings-scope = 範圍
jouzu-cli-localization-settings-scope-session = 僅此工作階段
jouzu-cli-localization-settings-scope-environment = 已儲存的設定
jouzu-cli-localization-settings-recovery = 寫入前會先備份先前的設定，重設則會還原預設值。
jouzu-cli-localization-settings-reset-confirm = 要將所有語言設定重設為預設值嗎？目前的設定會先備份。
jouzu-cli-localization-settings-no-change = 套用前請使用 ←/→ 選擇不同的值。
jouzu-cli-localization-settings-change = { $from } → { $to }
jouzu-cli-localization-settings-applied = 已套用至 { $scope }。備份: { $backup }。交易: { $transaction }。
jouzu-cli-localization-settings-applied-no-backup = 已套用至 { $scope }。不需要備份。交易: { $transaction }。
jouzu-cli-localization-settings-reset-done = 已重設為預設值。備份: { $backup }。交易: { $transaction }。
jouzu-cli-localization-settings-reset-done-no-backup = 已重設為預設值。不需要備份。交易: { $transaction }。
jouzu-cli-localization-settings-notices = 已通知其他工作階段此項已儲存的變更: { $count }。
jouzu-cli-localization-settings-apply-failed = 未儲存語言變更: { $message }
jouzu-cli-localization-settings-reset-failed = 未儲存重設: { $message }
jouzu-cli-localization-settings-hint-apply = 套用
jouzu-cli-localization-settings-hint-scope = 範圍
jouzu-cli-localization-settings-hint-reset = 重設
