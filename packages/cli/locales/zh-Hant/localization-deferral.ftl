# Messages for deferring a language change while work is in progress.
#
# This file is a second catalog namespace for the `zh-Hant` locale. The loader
# reads every `*.ftl` file in a locale directory, so a parallel lane can add its
# own file without editing `cli.ftl`. The IDs are catalog-only: they have no
# entry in `CatalogMessageId`, and `scripts/check-locales.mjs` requires the same
# set in every catalog.

jouzu-cli-localization-deferral-ime = 語言變更會等到正在組合的文字確認後才進行。
jouzu-cli-localization-deferral-confirmation = 語言變更會等到畫面上的確認獲得回應後才進行。
jouzu-cli-localization-deferral-streaming = 語言變更會等到回覆串流結束後才進行。
jouzu-cli-localization-deferral-tool = 語言變更會等到執行中的工具結束後才進行。
jouzu-cli-localization-deferral-update = 語言變更會等到更新結束後才進行。
jouzu-cli-localization-deferral-notice = 已延後語言變更: { $reason }
jouzu-cli-localization-deferral-fixed = 確認開啟期間，顯示語言會保持固定。
jouzu-cli-localization-deferral-reapproval = 變更語言並不會核准確認；請使用 { $confirm } 回應，或使用 { $cancel } 取消。
jouzu-cli-localization-deferral-upstream = Jouzu 未擁有的畫面會保持目前語言；它們會在下次開啟或重新啟動後切換。
