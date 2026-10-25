# 外部ユーザー入力のレシートと許可ファイルの表示理由。
#
# このファイルは `ja` ロケールの追加のカタログ名前空間です。ローダーは
# ロケールディレクトリ内のすべての `*.ftl` を読むため、`cli.ftl` を編集せずに
# メッセージを追加できます。`scripts/check-locales.mjs` は、ロックに記録された
# すべてのカタログが同じ ID 集合と同じ引数を持つことを要求します。
#
# この名前空間の翻訳はまだレビューされていないため、各エントリは英語の原文を
# そのまま保持しています。これはレビュー済みの翻訳ではありません。

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
