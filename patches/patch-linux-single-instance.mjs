#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Patches the Codex desktop app to prevent multiple instances on Linux.
//
// This patch adds a check for requestSingleInstanceLock() before the app ready
// state is handled. If the lock cannot be acquired, the app quits immediately.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "patch-linux-single-instance";
const appRoot = process.argv[2] ?? "app-extracted";
const buildRoot = join(appRoot, ".vite", "build");

function fail(message) {
  console.error(`${TAG}: ${message}`);
  process.exit(1);
}

if (!existsSync(buildRoot) || !statSync(buildRoot).isDirectory()) {
  fail(`could not find Vite build directory: ${buildRoot}`);
}

const mainFiles = readdirSync(buildRoot, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.startsWith("main-") && e.name.endsWith(".js"))
  .map((e) => join(buildRoot, e.name));

if (mainFiles.length !== 1) {
  fail(`expected one main-*.js bundle, found ${mainFiles.length}`);
}

const mainFile = mainFiles[0];
let source = readFileSync(mainFile, "utf8");

// Single Instance Lock
const readyRegex = /await ([A-Za-z_$][\w$]*)\.app\.whenReady\(\)/;
const readyMatch = source.match(readyRegex);

if (readyMatch && !source.includes("requestSingleInstanceLock")) {
  const appVar = readyMatch[1];
  const singleInstancePatch = `if(process.platform===\`linux\`&&!${appVar}.app.requestSingleInstanceLock()){${appVar}.app.quit();return}`;
  source = source.replace(readyRegex, `${singleInstancePatch};${readyMatch[0]}`);
  writeFileSync(mainFile, source);
  console.log(`${TAG}: patched single instance lock`);
} else {
  console.log(`${TAG}: single instance lock marker not found or already patched`);
}
