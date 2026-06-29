#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Patches Codex desktop primary window focusability on Linux.
//
// Adapted from ilysenko/codex-desktop-linux:
// scripts/patches/main-process/window.js applyLinuxPrimaryFocusablePatch().

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "patch-linux-keyboard-focus";
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
  .filter((entry) => entry.isFile() && entry.name.startsWith("main-") && entry.name.endsWith(".js"))
  .map((entry) => join(buildRoot, entry.name));

if (mainFiles.length !== 1) {
  fail(`expected one main-*.js bundle, found ${mainFiles.length}`);
}

const mainFile = mainFiles[0];
let source = readFileSync(mainFile, "utf8");
let patched = false;

function findCreateWindowAppearanceAlias(sourceText, matchIndex) {
  const prefix = sourceText.slice(Math.max(0, matchIndex - 3000), matchIndex);
  const createWindowRegex =
    /createWindow\([^)]*\)\{let\{[^}]*appearance:([A-Za-z_$][\w$]*)(?:=[^,}]+)?/g;
  let match;
  let appearanceAlias = null;
  while ((match = createWindowRegex.exec(prefix)) != null) {
    appearanceAlias = match[1];
  }
  return appearanceAlias;
}

function patchPrimaryWindowFocusable(sourceText) {
  if (
    sourceText.includes("===`primary`?{focusable:!0}") ||
    sourceText.includes("===`primary`?!0:")
  ) {
    return { source: sourceText, patched: false };
  }

  let patchedAny = false;
  const directRegex = /focusable:([A-Za-z_$][\w$]*),(\.\.\.process\.platform===`win32`)/g;
  const directSource = sourceText.replace(directRegex, (match, focusableAlias, platformOptions, offset) => {
    const appearanceAlias = findCreateWindowAppearanceAlias(sourceText, offset);
    if (appearanceAlias == null) {
      return match;
    }
    patchedAny = true;
    return (
      `focusable:process.platform===\`linux\`&&${appearanceAlias}===\`primary\`?!0:` +
      `${focusableAlias},${platformOptions}`
    );
  });

  if (patchedAny) {
    return { source: directSource, patched: true };
  }

  const spreadRegex =
    /\.\.\.([A-Za-z_$][\w$]*)==null\?\{\}:\{focusable:\1\},(\.\.\.process\.platform===`win32`)/g;
  const spreadSource = sourceText.replace(spreadRegex, (match, focusableAlias, platformOptions, offset) => {
    const appearanceAlias = findCreateWindowAppearanceAlias(sourceText, offset);
    if (appearanceAlias == null) {
      return match;
    }
    patchedAny = true;
    return (
      `...process.platform===\`linux\`&&${appearanceAlias}===\`primary\`?{focusable:!0}:` +
      `${focusableAlias}==null?{}:{focusable:${focusableAlias}},${platformOptions}`
    );
  });

  return { source: spreadSource, patched: patchedAny };
}

const focusablePatch = patchPrimaryWindowFocusable(source);
if (focusablePatch.patched) {
  source = focusablePatch.source;
  patched = true;
  console.log(`${TAG}: patched primary BrowserWindow focusable option`);
}

if (patched) {
  writeFileSync(mainFile, source);
} else {
  console.log(`${TAG}: bundle appears already patched`);
}
