# Messages for the `profile-migration` CLI entry.
#
# This file is a second catalog namespace for the `en` locale. The loader reads
# every `*.ftl` file in a locale directory, so a parallel lane can add its own
# file without editing `cli.ftl`. The IDs are catalog-only, except the two
# `jouzu.cli.args.*` argument errors, which the hand-maintained `CliMessageId`
# table also names. `scripts/check-locales.mjs` requires the same set in `en`
# and `ja`.

jouzu-cli-profileMigrationCommand-applied = Applied profile migration transaction: { $id }
jouzu-cli-profileMigrationCommand-alreadyApplied = No changes were needed; the migration is already applied.
jouzu-cli-profileMigrationCommand-willSave = Confirming this plan saves it to the user-wide settings.
jouzu-cli-profileMigrationCommand-changedTargets = Changed files: { $targets }
jouzu-cli-profileMigrationCommand-temporaryNotSaved = The profile choice is temporary; the user-wide settings were not written.
jouzu-cli-profileMigrationCommand-confirm = Apply this migration? [y/N]
jouzu-cli-profileMigrationCommand-confirmationRequired = This run is not interactive, so nothing was written. Re-run with --yes to confirm the migration.
jouzu-cli-profileMigrationCommand-cancelled = Cancelled; nothing was written.
jouzu-cli-profileMigrationCommand-conflict = The plan contains conflicts, so nothing was written.
jouzu-cli-profileMigrationCommand-rolledBack = Rolled back profile migration transaction: { $id }
jouzu-cli-profileMigrationCommand-rollbackUnchanged = The recorded migration had nothing to restore.
jouzu-cli-profileMigrationCommand-nothingToRollback = There is no recorded profile migration to roll back.
jouzu-cli-profileMigrationCommand-receiptUnreadable = The recorded profile migration could not be read.
jouzu-cli-args-profileMigrationOperationRequired = profile-migration requires "plan", "apply", or "rollback"
jouzu-cli-args-profileMigrationUnknownOption = unknown profile-migration { $operation } option: { $token }
