# Web tools

Jouzu includes these tools in both profiles. Ask the assistant to read a URL or
search for a topic; no MCP server or search API key is required.

| Tool | Use it to | Setup |
| --- | --- | --- |
| `web_fetch` | Read a known URL without running JavaScript | None |
| `batch_web_fetch` | Read multiple independent URLs at once | None |
| `tff-fetch_url` | Read a page in the Camoufox browser, with rendering or screenshots | Browser installs on first use |
| `tff-search_web` | Find pages with Google or DuckDuckGo | Browser installs on first use |

Web results pass through [TextGuard](textguard.md) before reaching the model.

## Fetch or search

The assistant can use `tff-fetch_url` when a page needs JavaScript or blocks a
direct fetch. Camoufox is a Firefox-based browser that supports CSS selectors
(to return a specific part of the page) and screenshots. Browser access does not
guarantee that a site will allow the request.

`tff-search_web` searches Google first and falls back to DuckDuckGo when Google
blocks the request or its results cannot be parsed. Its `engine` option accepts
`google` or `duckduckgo` to select one explicitly. The `max_results` option
defaults to 10 and accepts 1–50.

## Extraction diagnostics

If a page is missing text or looks incomplete, expand the `web_fetch` or
`batch_web_fetch` tool entry to see messages from Defuddle, the parser that
extracts readable page content. The messages are saved with the result rather
than printed over the terminal interface. Batch results keep each request's
messages separate.

A parser message does not necessarily mean the fetch failed: extraction may
recover or return fallback content. Messages have size limits and redact
credentials; raw stack traces are not retained.

## Browser runtime

- The first `tff-fetch_url` or `tff-search_web` call installs the Camoufox client version selected by your Jouzu release from npm into Jouzu's [state directory](configuration.md), then downloads the browser if needed.
- This needs network access and a writable Jouzu state directory.
- `jz doctor` reports the runtime as absent, ready, or invalid.
- The client version changes with Jouzu releases. It is not added to your package settings.

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
