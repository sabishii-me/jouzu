# Messages for applying and resetting the language settings from Settings.
#
# This file is a second catalog namespace for the `en` locale. The loader reads
# every `*.ftl` file in a locale directory, so a parallel lane can add its own
# file without editing `cli.ftl`. The IDs are catalog-only: they have no entry
# in `CatalogMessageId`, and `scripts/check-locales.mjs` requires the same set
# in `en` and `ja`.

jouzu-cli-localization-settings-confirm-heading = Save language change
jouzu-cli-localization-settings-reset-heading = Reset language settings
jouzu-cli-localization-settings-recovery = The previous settings are backed up before the write, and reset restores the saved display language to Automatic.
jouzu-cli-localization-settings-reset-confirm = Reset the saved display language to Automatic and clear this session's language overrides? Saved response and artifact choices are kept. The current settings are backed up first.
jouzu-cli-localization-settings-no-change = Choose a different value with ←/→ before applying.
jouzu-cli-localization-settings-change = { $from } → { $to }
jouzu-cli-localization-settings-applied = Saved for future sessions. Backup: { $backup }. Transaction: { $transaction }.
jouzu-cli-localization-settings-applied-no-backup = Saved for future sessions. Nothing needed a backup. Transaction: { $transaction }.
jouzu-cli-localization-settings-reset-done = Saved display language reset to Automatic; saved response and artifact choices were kept. Backup: { $backup }. Transaction: { $transaction }.
jouzu-cli-localization-settings-reset-done-no-backup = Saved display language reset to Automatic; saved response and artifact choices were kept. Nothing needed a backup. Transaction: { $transaction }.
jouzu-cli-localization-settings-saved-restart = Jouzu screens that support refresh switch now; restart Jouzu to update the rest.
jouzu-cli-localization-settings-notices = Other sessions were told about the saved change: { $count }.
jouzu-cli-localization-settings-apply-failed = The language change was not saved: { $message }
jouzu-cli-localization-settings-reset-failed = The reset was not saved: { $message }
jouzu-cli-localization-settings-hint-apply = apply
jouzu-cli-localization-settings-hint-reset = reset
