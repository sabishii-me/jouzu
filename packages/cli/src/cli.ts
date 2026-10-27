#!/usr/bin/env node

import { enableCompileCache } from "node:module";

// Node honors NODE_COMPILE_CACHE and NODE_DISABLE_COMPILE_CACHE, and returns a
// failure status rather than throwing when the cache directory is unavailable.
// Enable it before importing application modules so their compilation is cached.
enableCompileCache();
await import("./cli-bootstrap.js");
