import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

test.use({ channel: process.env.JOUZU_UI_TEST_BROWSER });

test("the last workspace opens and prewarms chat without a workspace click", async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem("jouzu.ui.language", "en");
    const w = window as any;
    w.isTauri = true;
    w.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener() {} };
    w.chatCalls = [];
    // The test serves assets over a plain-HTTP origin; real webviews and localhost are secure contexts.
    if (!crypto.randomUUID) Object.defineProperty(crypto, "randomUUID", { value: () => `test-${Math.random().toString(16).slice(2)}` });
    const records: any[] = [];
    const history: any[] = [];
    const models = [{ provider: "fixture", id: "deterministic", name: "Fixture model" }];
    const response = (r: any, data?: any) => records.push({ type: "response", id: r.id, command: r.type, success: true, data });
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: "main" }, currentWebview: { label: "main" } },
      transformCallback: () => 1, unregisterCallback() {},
      invoke: async (command: string, args: any) => {
        w.chatCalls.push(command);
        if (command === "launcher_state") return { ready: true, bash: true, bundled_git: true, platform: "windows", recent: [{ id: "work", path: "C:/Projects/Example", environment: { kind: "windows" } }] };
        if (command === "control_request") return { schemaVersion: 1, modelReady: true, profile: "core", account: { signedIn: false }, credentials: [], customProviders: [], providers: [], models: [] };
        if (command === "component_versions") return { jouzu: "0.3.8", development: true };
        if (command === "environment_read") return [];
        if (command === "chat_start") return "chat-test";
        if (command === "chat_poll") return { records: records.splice(0), closed: false };
        if (command === "chat_send") {
          const r = args.request;
          if (r.type === "get_state") response(r, { sessionId: "fixture", isStreaming: false, model: { name: "Fixture model" } });
          else if (r.type === "get_messages") response(r, { messages: history });
          else if (r.type === "get_available_models") response(r, { models });
          else if (r.type === "get_available_thinking_levels") response(r, { levels: [] });
          else if (r.type === "set_model") response(r, models.find(model => model.provider === r.provider && model.id === r.modelId) ?? models[0]);
          else if (r.type === "prompt" || r.type === "steer") {
            w.lastPrompt = r;
            if (r.type === "prompt") {
              const user = { role: "user", content: r.message };
              const assistant = { role: "assistant", content: [{ type: "text", text: "**Hello** from Jouzu" }] };
              history.push(user, assistant);
              records.push({ type: "agent_start" }, { type: "message_start", message: user }, { type: "message_end", message: user }, { type: "message_start", message: { role: "assistant", content: [] } }, { type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } }, { type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "**Hello** from Jouzu" } }, { type: "message_end", message: assistant }, { type: "agent_end", willRetry: false }, { type: "agent_settled" });
            }
            // The released runtime answers a successful prompt with no data at all.
            response(r);
          } else if (r.type === "new_session") { history.length = 0; response(r, { cancelled: false }); }
          else response(r);
          return;
        }
        if (command.includes("version")) return "0.3.8";
        return 1;
      },
    };
  });
  const dist = resolve("dist");
  await page.route("http://jouzu-ui.test/**", async route => {
    const pathname = decodeURIComponent(new URL(route.request().url()).pathname);
    const file = resolve(dist, pathname === "/" ? "index.html" : `.${pathname}`);
    if (!file.startsWith(dist + sep)) return route.abort();
    const contentType = ({ ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml" } as Record<string, string>)[extname(file)] ?? "application/octet-stream";
    try { await route.fulfill({ body: await readFile(file), contentType }); } catch { await route.fulfill({ status: 404, body: "Not found" }); }
  });
  await page.goto("http://jouzu-ui.test/");
  // No workspace click: the launcher opens the last workspace and starts the runtime itself.
  await expect(page.getByLabel("Message Jouzu")).toBeVisible();
  await expect.poll(() => page.evaluate(() => (window as any).chatCalls.includes("chat_start"))).toBe(true);
  expect(await page.evaluate(() => (window as any).chatCalls.includes("launch_jouzu"))).toBe(false);
  await expect(page.getByRole("complementary", { name: "Workspaces" })).toBeVisible();
  await page.getByLabel("Message Jouzu").fill("Explain this project");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("article", { name: "assistant message" })).toContainText("Hello from Jouzu");
  await expect(page.getByRole("article", { name: "user message" })).toHaveCount(1);
  await expect(page.getByLabel("Message Jouzu")).toHaveValue("");
  await expect(page.getByRole("button", { name: "Model", exact: true })).toContainText("Fixture model");
  await page.getByLabel("Choose images").setInputFiles({ name: "pixel.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
  await expect(page.getByRole("img", { name: "Preview of pixel.png" })).toBeVisible();
  await page.getByLabel("Message Jouzu").fill("Inspect this image");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await expect(page.getByRole("img", { name: "Preview of pixel.png" })).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).lastPrompt.images)).toEqual([expect.objectContaining({ type: "image", mimeType: "image/png" })]);
  await page.getByRole("button", { name: "New chat", exact: true }).click();
  await expect(page.getByRole("article")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Open in terminal", exact: true })).toBeVisible();
});
