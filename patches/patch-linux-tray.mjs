#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Patches the Codex desktop app to enable system tray support on Linux.
//
// The macOS/Windows app has a tray implementation that is guarded by a platform check.
// This patch adds 'linux' to that platform guard.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "patch-linux-tray";
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

// Enable System Tray for Linux
// Target: process.platform!==`win32`&&process.platform!==`darwin`?null:new n.Tray
const trayGuardRegex = /process\.platform!==`win32`&&process\.platform!==`darwin`\?null:/g;

if (!trayGuardRegex.test(source)) {
  if (source.includes("process.platform!==`win32`&&process.platform!==`darwin`&&process.platform!==`linux`?null:")) {
    console.log(`${TAG}: bundle appears already patched`);
    process.exit(0);
  }
  fail("tray platform guard not found");
}

const patchedSource = source.replace(trayGuardRegex, "process.platform!==`win32`&&process.platform!==`darwin`&&process.platform!==`linux`?null:");

if (!patchedSource.includes("&&process.platform!==`linux`?null:")) {
  fail("patch verification failed: linux platform guard not found after patching");
}

writeFileSync(mainFile, patchedSource);
console.log(`${TAG}: enabled system tray support for Linux`);
