#!/usr/bin/env node

import { cpSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const source = resolve(root, "packages", "cli", "locales");
const destination = resolve(root, "packages", "cli", "dist", "locales");

if (!existsSync(source)) throw new Error(`locale source directory is missing: ${source}`);
rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true, dereference: false });
console.log(`copied locale catalogs to ${destination}`);
