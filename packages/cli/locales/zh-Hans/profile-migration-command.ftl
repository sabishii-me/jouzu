# Messages for the `profile-migration` CLI entry.
#
# This file is a second catalog namespace for the `zh-Hans` locale. The loader
# reads every `*.ftl` file in a locale directory, so a parallel lane can add its
# own file without editing `cli.ftl`. The IDs are catalog-only, except the two
# `jouzu.cli.args.*` argument errors, which the hand-maintained `CliMessageId`
# table also names. `scripts/check-locales.mjs` requires the same set in every
# catalog.

jouzu-cli-profileMigrationCommand-applied = 已应用配置档案迁移事务：{ $id }
jouzu-cli-profileMigrationCommand-alreadyApplied = 无需更改；迁移已应用。
jouzu-cli-profileMigrationCommand-willSave = 确认此计划会将其保存到用户级设置。
jouzu-cli-profileMigrationCommand-changedTargets = 已更改的文件：{ $targets }
jouzu-cli-profileMigrationCommand-temporaryNotSaved = 配置档案选择是临时的；未写入用户级设置。
jouzu-cli-profileMigrationCommand-confirm = 应用此迁移？[y/N]
jouzu-cli-profileMigrationCommand-confirmationRequired = 此运行不是交互式的，因此未写入任何内容。请用 --yes 重新运行以确认迁移。
jouzu-cli-profileMigrationCommand-cancelled = 已取消；未写入任何内容。
jouzu-cli-profileMigrationCommand-conflict = 计划包含冲突，因此未写入任何内容。
jouzu-cli-profileMigrationCommand-rolledBack = 已回滚配置档案迁移事务：{ $id }
jouzu-cli-profileMigrationCommand-rollbackUnchanged = 记录的迁移没有需要恢复的内容。
jouzu-cli-profileMigrationCommand-nothingToRollback = 没有可回滚的已记录配置档案迁移。
jouzu-cli-profileMigrationCommand-receiptUnreadable = 无法读取已记录的配置档案迁移。
jouzu-cli-args-profileMigrationOperationRequired = profile-migration 需要 "plan"、"apply" 或 "rollback" 之一
jouzu-cli-args-profileMigrationUnknownOption = 未知的 profile-migration { $operation } 选项：{ $token }
