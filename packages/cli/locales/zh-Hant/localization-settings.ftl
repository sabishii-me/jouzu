# Messages for applying and resetting the language settings from Settings.
#
# This file is a second catalog namespace for the `zh-Hant` locale. The loader
# reads every `*.ftl` file in a locale directory, so a parallel lane can add its
# own file without editing `cli.ftl`. The IDs are catalog-only: they have no
# entry in `CatalogMessageId`, and `scripts/check-locales.mjs` requires the same
# set in every catalog.

jouzu-cli-localization-settings-confirm-heading = 儲存語言變更
jouzu-cli-localization-settings-reset-heading = 重設語言設定
jouzu-cli-localization-settings-recovery = 寫入前會先備份先前的設定，重設會將已儲存的顯示語言還原為自動。
jouzu-cli-localization-settings-reset-confirm = 要將已儲存的顯示語言還原為自動，並清除此工作階段的語言覆寫嗎？已儲存的回應語言與產出設定會保留。目前的設定會先備份。
jouzu-cli-localization-settings-no-change = 套用前請使用 ←/→ 選擇不同的值。
jouzu-cli-localization-settings-change = { $from } → { $to }
jouzu-cli-localization-settings-applied = 已為將來的工作階段儲存。備份: { $backup }。交易: { $transaction }。
jouzu-cli-localization-settings-applied-no-backup = 已為將來的工作階段儲存。不需要備份。交易: { $transaction }。
jouzu-cli-localization-settings-reset-done = 已將儲存的顯示語言還原為自動，並保留了已儲存回應語言與產出設定。備份: { $backup }。交易: { $transaction }。
jouzu-cli-localization-settings-reset-done-no-backup = 已將儲存的顯示語言還原為自動，並保留了已儲存回應語言與產出設定。不需要備份。交易: { $transaction }。
jouzu-cli-localization-settings-saved-restart = 支援重新整理的 Jouzu 介面會立即切換；其餘介面會在重新啟動 Jouzu 後更新。
jouzu-cli-localization-settings-notices = 已通知其他工作階段此項已儲存的變更: { $count }。
jouzu-cli-localization-settings-apply-failed = 未儲存語言變更: { $message }
jouzu-cli-localization-settings-reset-failed = 未儲存重設: { $message }
jouzu-cli-localization-settings-hint-apply = 套用
jouzu-cli-localization-settings-hint-reset = 重設
