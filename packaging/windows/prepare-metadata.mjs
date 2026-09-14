import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const payload = process.argv[2];
for (const relative of ["app/package.json", "app/package-lock.json", "app/node_modules/.package-lock.json"]) {
    const path = join(payload, relative);
    const metadata = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
    if (metadata.dependencies?.jouzu) metadata.dependencies.jouzu = "file:jouzu.tgz";
    if (metadata.packages?.[""]?.dependencies?.jouzu) metadata.packages[""].dependencies.jouzu = "file:jouzu.tgz";
    if (metadata.packages?.["node_modules/jouzu"]) metadata.packages["node_modules/jouzu"].resolved = "file:jouzu.tgz";
    writeFileSync(path, `${JSON.stringify(metadata, null, 2)}\n`);
}
