# Messages for applying and resetting the language settings from Settings.
#
# This file is a second catalog namespace for the `zh-Hans` locale. The loader
# reads every `*.ftl` file in a locale directory, so a parallel lane can add its
# own file without editing `cli.ftl`. The IDs are catalog-only: they have no
# entry in `CatalogMessageId`, and `scripts/check-locales.mjs` requires the same
# set in every catalog.

jouzu-cli-localization-settings-confirm-heading = 保存语言更改
jouzu-cli-localization-settings-reset-heading = 重置语言设置
jouzu-cli-localization-settings-recovery = 写入前会备份之前的设置，重置会将保存的显示语言恢复为自动。
jouzu-cli-localization-settings-reset-confirm = 将保存的显示语言恢复为自动，并清除此会话的语言覆盖？已保存的响应语言和成果物设置会保留。当前设置会先备份。
jouzu-cli-localization-settings-no-change = 应用前请用 ←/→ 选择不同的值。
jouzu-cli-localization-settings-change = { $from } → { $to }
jouzu-cli-localization-settings-applied = 已为将来的会话保存。备份：{ $backup }。事务：{ $transaction }。
jouzu-cli-localization-settings-applied-no-backup = 已为将来的会话保存。无需备份。事务：{ $transaction }。
jouzu-cli-localization-settings-reset-done = 已将保存的显示语言恢复为自动，并保留了已保存的响应语言和成果物设置。备份：{ $backup }。事务：{ $transaction }。
jouzu-cli-localization-settings-reset-done-no-backup = 已将保存的显示语言恢复为自动，并保留了已保存的响应语言和成果物设置。无需备份。事务：{ $transaction }。
jouzu-cli-localization-settings-saved-restart = 支持刷新的 Jouzu 界面会立即切换；其余界面会在重启 Jouzu 后更新。
jouzu-cli-localization-settings-notices = 已通知其他会话有关已保存的更改：{ $count }。
jouzu-cli-localization-settings-apply-failed = 语言更改未保存：{ $message }
jouzu-cli-localization-settings-reset-failed = 重置未保存：{ $message }
jouzu-cli-localization-settings-hint-apply = 应用
jouzu-cli-localization-settings-hint-reset = 重置
