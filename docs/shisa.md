# Shisa AI account

A [Shisa AI](https://platform.shisa.ai/) account provides open coding models, the Shisa model catalog, and [voice input](voice.md). Each service needs access on your account.

- New accounts receive USD 10 in credits. Adding a credit card adds USD 25 more. These signup offers are not an account balance.
- On first launch without a Shisa credential, Jouzu offers to connect once. Answer `y` to sign in; press `Enter` or `n` to skip.

## Sign in

1. Run `/login shisa`, or press `Enter` on the **Shisa AI** row in Settings.
2. Open the verification URL Jouzu shows and approve in your browser.

Jouzu saves a dedicated API key and device link with private file permissions, then refreshes catalogs and models without a restart.

## Settings row

The **Shisa AI** row sits at the top of Settings / Catalogs.

| State | Row shows |
| --- | --- |
| Signed out | `Not connected` and the signup credits |
| Signed in | Organization and dashboard address |
| Using `SHISA_API_KEY` | `Connected · SHISA_API_KEY` |

| Key | Action |
| --- | --- |
| `Enter` | Start sign-in |
| `Esc` | Cancel sign-in without closing Settings |
| `D` | Sign out, after confirmation |

## Credentials

| Service | Credential order |
| --- | --- |
| Inference and voice | `SHISA_API_KEY`, then the saved login |
| Model catalog | `SHISA_API_KEY`, then a saved catalog token, then the saved login |

## Sign out

Run `/logout shisa`, select Shisa in `/logout`, or press `D` on the Settings row.

- Jouzu asks Shisa to revoke the key, then removes the local key and device link.
- Voice recording stops and Shisa catalog models leave the Models view.
- Other providers keep their credentials.
- For the rest of the process, Jouzu's Shisa login, catalog, and voice ignore `SHISA_API_KEY`. Unset it before restarting to stay signed out, or run `/login shisa` to reconnect.

## Troubleshooting

| Message or symptom | Action |
| --- | --- |
| Revocation not confirmed | You are signed out locally. Disconnect the device in the Shisa dashboard. |
| Saved link has no issuing gateway | Disconnect the device in the Shisa dashboard. |
| Key saved but delivery to Shisa not confirmed | Sign in again. |
| Server confirmation failed after saving credentials | Follow the recovery instructions shown in the panel. |
