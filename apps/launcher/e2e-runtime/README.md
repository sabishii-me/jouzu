# Released-runtime acceptance harness

These scripts exercise the desktop against an **official extracted Jouzu setup**. They are
opt-in; the default unit suites stay hermetic.

## RPC matrix

```powershell
$env:JOUZU_E2E_RUNTIME = '<extracted official setup>'
$env:JOUZU_E2E_HOME = '<isolated home>'
$env:JOUZU_E2E_WORKSPACE = '<workspace folder>'
npm run test:runtime
```

Covers `get_state`, `prompt` (success without `data`), `steer`, `abort`, `clear_queue`,
`new_session`, `get_messages`, `switch_session` with restored history, model catalog and
`set_model`, `compact` (or its small-session guard), and `export_html` with a written file.
It starts a loopback OpenAI-compatible server and a test-only provider extension; it never
contacts a paid provider, installs anything, or patches the runtime. Results are written to
`rpc-matrix-result.json`.

## UI flow

Prerequisites:

1. The app is running with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9223`.
2. An isolated profile has a provider pointing at `http://127.0.0.1:43123/v1` with model
   `deterministic` and a saved fixture key.
3. The fixture server is running:
   `JOUZU_FIXTURE_PORT=43123 node e2e-runtime/fixture-server.mjs`

```powershell
npm run test:ui
```

Covers opening into a prewarmed workspace, model selection, prompt streaming, a real tool
call, steering while running, Stop/abort, New chat and continuation. Results are written to
`ui-flow-result.json`.

The native Resume file picker is not automatable through CDP; `switch_session` is covered by
the RPC matrix and the picker has a manual acceptance checklist in the handoff.
