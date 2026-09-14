import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { delimiter, join } from "node:path";
import { pathToFileURL } from "node:url";

const [payload, project] = process.argv.slice(2);
const pi = join(payload, "app", "node_modules", "jouzu", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "index.js");
const { createLocalBashOperations, createReadToolDefinition, createWriteToolDefinition } =
    await import(pathToFileURL(pi));
process.env.PATH = ["node", "tools", "git/cmd", "git/bin", "git/usr/bin"]
    .map((relative) => join(payload, relative)).concat(process.env.PATH || "").join(delimiter);
const output = [];
const shell = createLocalBashOperations({ shellPath: join(payload, "git", "bin", "bash.exe") });
const result = await shell.exec(
    "node --version && npm --version && git --version && rg --version && fd --version",
    project,
    { onData: (data) => output.push(Buffer.from(data)), timeout: 30 },
);
assert.equal(result.exitCode, 0, Buffer.concat(output).toString());
assert.match(Buffer.concat(output).toString(), /ripgrep/);
const directory = mkdtempSync(join(project, "日本語 tool paths "));
const file = join(directory, "backslash test.txt");
try {
    const write = createWriteToolDefinition(project);
    await write.execute("write-fixture", { path: file, content: "日本語 and Windows paths\r\n" });
    assert.equal(readFileSync(file, "utf8"), "日本語 and Windows paths\r\n");
    const read = createReadToolDefinition(project);
    const readResult = await read.execute("read-fixture", { path: file });
    assert.match(JSON.stringify(readResult), /日本語 and Windows paths/);
} finally {
    rmSync(directory, { recursive: true });
}
console.log("Bundled Pi shell, read, and write tools passed Windows path tests");
