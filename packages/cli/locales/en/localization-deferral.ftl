# Messages for deferring a language change while work is in progress.
#
# This file is a second catalog namespace for the `en` locale. The loader reads
# every `*.ftl` file in a locale directory, so a parallel lane can add its own
# file without editing `cli.ftl`. The IDs are catalog-only: they have no entry
# in `CatalogMessageId`, and `scripts/check-locales.mjs` requires the same set
# in `en` and `ja`.

jouzu-cli-localization-deferral-ime = A language change waits until the text being composed is confirmed.
jouzu-cli-localization-deferral-confirmation = A language change waits until the confirmation on screen is answered.
jouzu-cli-localization-deferral-streaming = A language change waits until the reply finishes streaming.
jouzu-cli-localization-deferral-tool = A language change waits until the running tool finishes.
jouzu-cli-localization-deferral-update = A language change waits until the update finishes.
jouzu-cli-localization-deferral-notice = Language change deferred: { $reason }
jouzu-cli-localization-deferral-fixed = The display language stays fixed while the confirmation is open.
jouzu-cli-localization-deferral-reapproval = Changing the language does not approve the confirmation; answer it with { $confirm } or cancel it with { $cancel }.
jouzu-cli-localization-deferral-upstream = Screens Jouzu does not own keep the current language; they switch the next time they open or after a restart.
