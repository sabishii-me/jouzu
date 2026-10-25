# Display reasons for external user-input receipts and grants denials.
#
# This file is an additional catalog namespace for the `zh-Hans` locale. The loader
# reads every `*.ftl` file in a locale directory, so this draft adds its messages
# without rewriting `cli.ftl`, and `scripts/check-locales.mjs` requires the same
# ID set and arguments in every catalog the lock records.
#
# No translation of this namespace has been reviewed, so each entry repeats the
# English source sentence below. That is documented fallback text, not a
# reviewed translation, and the draft stays unreviewed in `catalog-status.json`.

jouzu-cli-flow-userInput-receipt-admissionHold = Input is waiting for admission.
jouzu-cli-flow-userInput-receipt-handledWithoutInput = The input handler completed without passing this input to the model.
jouzu-cli-flow-userInput-receipt-submissionCancelled = The retained input was cancelled before delivery.
jouzu-cli-flow-userInput-receipt-queueCancelled = The queued input was removed before it ran.
jouzu-cli-flow-userInput-receipt-contextCancelled = The deferred context was removed before it ran.
jouzu-cli-flow-userInput-receipt-dispatchFailed = Native dispatch failed before it produced input, so delivery is unconfirmed.
jouzu-cli-flow-userInput-receipt-dispatchUnconfirmed = Input was dispatched without a receipt that confirms or rules out delivery.
jouzu-cli-flow-userInput-receipt-queueEvidenceMissing = The queued input is not in the live host queue, so delivery is unconfirmed.
jouzu-cli-flow-userInput-receipt-cancellationUnconfirmed = A cancellation was requested but the native removal is not confirmed.
jouzu-cli-flow-userInput-receipt-flowSuspended = Flow control was suspended before this input was delivered.
jouzu-cli-flow-userInput-receipt-unauthorized = The adapter's authorization was revoked before this input was delivered.
jouzu-cli-flow-userInput-grants-agentDirectoryNotDirectory = the agent configuration directory must be a real directory
jouzu-cli-flow-userInput-grants-agentDirectoryUninspectable = the agent configuration directory could not be inspected
jouzu-cli-flow-userInput-grants-uninspectable = user-input adapter grants could not be inspected
jouzu-cli-flow-userInput-grants-notRegularFile = user-input adapter grants must be a real regular file
jouzu-cli-flow-userInput-grants-tooLarge = user-input adapter grants must be no larger than { $bytes } bytes
jouzu-cli-flow-userInput-grants-notUtf8 = user-input adapter grants must be readable UTF-8
