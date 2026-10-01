# Web tools

| Tool | How it fetches | Setup |
| --- | --- | --- |
| `web_fetch`, `batch_web_fetch` | Direct HTTP, returns readable text | None |
| `tff-fetch_url`, `tff-search_web` | Rendered in the Camoufox browser | Installs on first use |

Web results pass through [TextGuard](textguard.md) before reaching the model.

## Browser runtime

- The first `tff-fetch_url` or `tff-search_web` call installs Jouzu's pinned Camoufox client from npm into Jouzu state, then downloads the Camoufox browser if needed.
- This needs network access and a writable Jouzu state directory.
- `jz doctor` reports the runtime as absent, ready, or invalid.
- The pinned client versions update with Jouzu releases. They are not added to your package settings.

## Limits

- Rendered fetches return up to 50,000 characters and mark truncation.
- Search marks empty results as inconclusive, and results at the requested limit as possibly incomplete.
- Screenshots default to JPEG and attach only when 1 MiB or smaller.

## Idle shutdown

- The browser stops after five minutes without a browser tool call, to free memory. The next call relaunches it, which takes a few seconds.
- Set `JOUZU_CAMOUFOX_IDLE_STOP_MS` to change the delay:

| Value | Effect |
| --- | --- |
| `1000` to `2147483647` | Stop after that many milliseconds |
| `0` | Keep the browser running until the session ends |
| Anything else | Browser tools do not load for that session; the startup warning shows why |

Stopping ends the browser process. Runtime modules already loaded stay in memory.

## Older enterprise Linux

- Install the GTK, X11, and audio libraries that Firefox needs.
- If the system NSS library is older than Camoufox requires, set `JOUZU_CAMOUFOX_LIBRARY_PATH` to a directory with a compatible NSS. Jouzu applies it only to the browser process.
