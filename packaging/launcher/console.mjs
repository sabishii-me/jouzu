import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";

const root = dirname(fileURLToPath(import.meta.url));
const child = spawn(process.execPath, [join(root, "bootstrap.mjs"), ...process.argv.slice(2)], { stdio: "inherit", env: process.env });
process.on("SIGINT", () => {}); // The console also delivers Ctrl+C to the TUI.
let finished = false;
function finish(code, message) {
  if (finished) return;
  finished = true;
  if (code === 0) { process.exitCode = 0; return; }
  console.error(`\nJouzu stopped before completing normally. ${message}`);
  try {
    const logs = join(process.env.LOCALAPPDATA, "JouzuDesktop", "logs");
    mkdirSync(logs, { recursive: true });
    appendFileSync(join(logs, "launch.log"), `${new Date().toISOString()} exit=${code} ${message}\n`);
  } catch {}
  if (process.stdin.isTTY) {
    const reader = createInterface({ input: process.stdin, output: process.stdout });
    reader.question("Press Enter to close this window…", () => { reader.close(); process.exitCode = code; });
  } else process.exitCode = code;
}
child.on("error", error => finish(1, error.message));
child.on("exit", (code, signal) => finish(code ?? 1, signal ? `Signal: ${signal}` : `Exit code: ${code}`));
