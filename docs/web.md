# Web tools

Jouzu includes these tools in both profiles. Ask the assistant to read a URL or
search for a topic; no MCP server or search API key is required.

| Tool | How it fetches | Setup |
| --- | --- | --- |
| `web_fetch`, `batch_web_fetch` | Direct HTTP, returns readable text | None |
| `tff-fetch_url`, `tff-search_web` | Rendered in the Camoufox browser | Installs on first use |

Web results pass through [TextGuard](textguard.md) before reaching the model.

## Fetch or search

- For a known URL, `web_fetch` extracts readable content without executing JavaScript. `batch_web_fetch` fetches independent URLs concurrently.
- For pages that need JavaScript rendering or encounter bot protection, `tff-fetch_url` uses Camoufox, a Firefox-based browser. It supports CSS selectors and screenshots. Browser access does not guarantee that a site will allow the request.
- For discovery, `tff-search_web` searches Google by default and falls back to DuckDuckGo when Google blocks the request or its results cannot be parsed. Set `engine` to `google` or `duckduckgo` to select one explicitly. `max_results` defaults to 10 and accepts 1–50.

## Extraction diagnostics

`web_fetch` and `batch_web_fetch` save Defuddle parser diagnostics with the tool result instead of printing them over the terminal interface. Expand the tool entry to review them. Batch results keep each request's diagnostics separate.

A diagnostic does not necessarily mean the fetch failed: the parser can recover or return fallback content. Diagnostic messages are bounded, with credentials redacted; raw stack traces are not retained.

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
