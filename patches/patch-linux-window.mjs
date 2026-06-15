#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Patches the Codex desktop app to improve window behavior on Linux.
//
// Changes:
//   1. Hides the menu bar by default (setMenuBarVisibility(false)).
//   2. Sets the window icon to the bundled assets/icon.png.
//   3. Prevents a crash in the "About" dialog when calling getFileIcon on Linux.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "patch-linux-window";
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
let patched = false;

// 1. Hide Menu Bar
const menuRegex = /process\.platform===`win32`&&([A-Za-z_$][\w$]*)\.removeMenu\(\),/g;
if (menuRegex.test(source)) {
  source = source.replace(menuRegex, (match, windowVar) => `process.platform===\`linux\`&&${windowVar}.setMenuBarVisibility(!1),${match}`);
  console.log(`${TAG}: patched menu bar visibility`);
  patched = true;
}

// 2. Set Window Icon
const iconPathExpr = "process.resourcesPath+`/../content/webview/assets/icon.png`";
const readyRegex = /([A-Za-z_$][\w$]*)\.once\(`ready-to-show`,\(\)=>\{/g;
if (readyRegex.test(source)) {
  source = source.replace(readyRegex, (match, windowVar) => {
    if (source.includes(`${windowVar}.setIcon(`)) return match;
    return `process.platform===\`linux\`&&${windowVar}.setIcon(${iconPathExpr}),${match}`;
  });
  console.log(`${TAG}: patched window icon setter`);
  patched = true;
}

// 3. Fix About Dialog getFileIcon crash
const fileIconRegex = /([A-Za-z_$][\w$]*)\.app\.getFileIcon\(([^()]+),\{size:process\.platform===`win32`\?`large`:`normal`\}\)/g;
if (fileIconRegex.test(source)) {
  source = source.replace(fileIconRegex, (match) => `process.platform===\`linux\`?Promise.resolve(null):${match}`);
  console.log(`${TAG}: patched about dialog file icon`);
  patched = true;
}

if (patched) {
  writeFileSync(mainFile, source);
} else {
  console.log(`${TAG}: no patches applied (already patched?)`);
}
