# Messages for applying and resetting the language settings from Settings.
#
# This file is a second catalog namespace for the `en` locale. The loader reads
# every `*.ftl` file in a locale directory, so a parallel lane can add its own
# file without editing `cli.ftl`. The IDs are catalog-only: they have no entry
# in `CatalogMessageId`, and `scripts/check-locales.mjs` requires the same set
# in `en` and `ja`.

jouzu-cli-localization-settings-confirm-heading = Apply language change
jouzu-cli-localization-settings-reset-heading = Reset language settings
jouzu-cli-localization-settings-scope = Scope
jouzu-cli-localization-settings-scope-session = This session only
jouzu-cli-localization-settings-scope-environment = Saved setting
jouzu-cli-localization-settings-recovery = The previous settings are backed up before the write, and reset restores the defaults.
jouzu-cli-localization-settings-reset-confirm = Reset every language setting to its default? The current settings are backed up first.
jouzu-cli-localization-settings-no-change = Choose a different value with ←/→ before applying.
jouzu-cli-localization-settings-change = { $from } → { $to }
jouzu-cli-localization-settings-applied = Applied to { $scope }. Backup: { $backup }. Transaction: { $transaction }.
jouzu-cli-localization-settings-applied-no-backup = Applied to { $scope }. Nothing needed a backup. Transaction: { $transaction }.
jouzu-cli-localization-settings-reset-done = Reset to the defaults. Backup: { $backup }. Transaction: { $transaction }.
jouzu-cli-localization-settings-reset-done-no-backup = Reset to the defaults. Nothing needed a backup. Transaction: { $transaction }.
jouzu-cli-localization-settings-notices = Other sessions were told about the saved change: { $count }.
jouzu-cli-localization-settings-apply-failed = The language change was not saved: { $message }
jouzu-cli-localization-settings-reset-failed = The reset was not saved: { $message }
jouzu-cli-localization-settings-hint-apply = apply
jouzu-cli-localization-settings-hint-scope = scope
jouzu-cli-localization-settings-hint-reset = reset
