# Messages for deferring a language change while work is in progress.
#
# This file is a second catalog namespace for the `zh-Hans` locale. The loader
# reads every `*.ftl` file in a locale directory, so a parallel lane can add its
# own file without editing `cli.ftl`. The IDs are catalog-only: they have no
# entry in `CatalogMessageId`, and `scripts/check-locales.mjs` requires the same
# set in every catalog.

jouzu-cli-localization-deferral-ime = 语言更改会等到正在组合的文本被确认后再进行。
jouzu-cli-localization-deferral-confirmation = 语言更改会等到屏幕上的确认被回答后再进行。
jouzu-cli-localization-deferral-streaming = 语言更改会等到回复完成流式输出后再进行。
jouzu-cli-localization-deferral-tool = 语言更改会等到正在运行的工具结束后再进行。
jouzu-cli-localization-deferral-update = 语言更改会等到更新结束后再进行。
jouzu-cli-localization-deferral-notice = 语言更改已推迟：{ $reason }
jouzu-cli-localization-deferral-fixed = 确认窗口打开期间显示语言保持固定。
jouzu-cli-localization-deferral-reapproval = 更改语言不会批准该确认；请用 { $confirm } 回答，或用 { $cancel } 取消。
jouzu-cli-localization-deferral-upstream = Jouzu 不拥有的屏幕保持当前语言；它们会在下次打开时或重启后切换。
