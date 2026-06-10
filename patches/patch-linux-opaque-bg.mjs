#!/usr/bin/env node
// SPDX-FileCopyrightText: 2026 Arch Linux Contributors
// SPDX-License-Identifier: 0BSD
//
// Patches the Codex desktop app to use opaque window backgrounds on Linux.
//
// The macOS app uses transparent BrowserWindow backgrounds (#00000000) for
// vibrancy/mica effects. Linux compositors (especially Nvidia on Wayland) do
// not handle these correctly, causing rendering artifacts.
//
// Two patches are applied:
//   1. Main process bundle: adds a Linux branch to the BrowserWindow background
//      color function so it returns opaque colors instead of transparent.
//   2. Webview theme files: defaults opaqueWindows to true so the UI does not
//      attempt translucent sidebar/chrome styles.

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "patch-linux-opaque-bg";
const appRoot = process.argv[2] ?? "app-extracted";
const buildRoot = join(appRoot, ".vite", "build");
const webviewAssets = join(appRoot, "webview", "assets");

function fail(message) {
  console.error(`${TAG}: ${message}`);
  process.exit(1);
}

// ---------- 1. Patch main process bundle ----------

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
let mainSource = readFileSync(mainFile, "utf8");

function patchPlatformChecks(source) {
  let patched = source;
  const platformCheckRe = new RegExp(
    "function\\s+([A-Za-z_$][\\w$]*)\\(" +
      "\\{appearance:([A-Za-z_$][\\w$]*)," +
      "(?:opaqueWindowsEnabled|isFocused):([A-Za-z_$][\\w$]*)," +
      "platform:([A-Za-z_$][\\w$]*)\\}\\)" +
      "\\{return([^{}]+?)&&\\(\\4===`darwin`\\|\\|\\4===`win32`\\)\\}",
    "g"
  );

  patched = patched.replace(platformCheckRe, (fullMatch, funcName, appearanceVar, stateVar, platformVar, prefix) => {
    if (fullMatch.includes(`${platformVar}===\`linux\``)) {
      return fullMatch;
    }
    return (
      `function ${funcName}({appearance:${appearanceVar},` +
      `${fullMatch.includes("opaqueWindowsEnabled") ? "opaqueWindowsEnabled" : "isFocused"}:${stateVar},` +
      `platform:${platformVar}}){return${prefix}&&` +
      `(${platformVar}===\`darwin\`||${platformVar}===\`win32\`||${platformVar}===\`linux\`)}`
    );
  });

  return patched;
}

function patchSurfaceBackgroundFunction(source) {
  // Match the BrowserWindow background color function:
  //   function <NAME>({platform:<P>,appearance:<A>,opaqueWindowSurfaceEnabled:<O>,prefersDarkColors:<D>}){
  //     return <O>
  //       ? {backgroundColor:<D>?<DARK>:<LIGHT>,backgroundMaterial:<P>===`win32`?`none`:null}
  //       : <P>===`win32`&&!<PRED>(<A>)
  //         ? {backgroundColor:<TRANS>,backgroundMaterial:`mica`}
  //         : {backgroundColor:<TRANS>,backgroundMaterial:null}
  //   }
  const bgFuncRe = new RegExp(
    "function\\s+([A-Za-z_$][\\w$]*)\\(" +
      "\\{platform:([A-Za-z_$][\\w$]*)," +
      "appearance:([A-Za-z_$][\\w$]*)," +
      "opaqueWindowSurfaceEnabled:([A-Za-z_$][\\w$]*)," +
      "prefersDarkColors:([A-Za-z_$][\\w$]*)\\}\\)" +
      "\\{return\\s*\\4\\?" +
      "\\{backgroundColor:\\5\\?([A-Za-z_$][\\w$]*):([A-Za-z_$][\\w$]*)," +
      "backgroundMaterial:\\2===`win32`\\?`none`:null\\}" +
      ":(\\2===`win32`&&!([A-Za-z_$][\\w$]*)\\(\\3\\)\\?" +
      "\\{backgroundColor:([A-Za-z_$][\\w$]*)," +
      "backgroundMaterial:`mica`\\})" +
      ":\\{backgroundColor:\\10,backgroundMaterial:null\\}\\}"
  );

  const bgMatch = source.match(bgFuncRe);
  if (!bgMatch) {
    return { source, patched: false };
  }

  const [fullMatch, , pVar, aVar, , dVar, darkVar, lightVar, win32Branch, predFunc] = bgMatch;
  const linuxBranch =
    `${pVar}===\`linux\`&&!${predFunc}(${aVar})` +
    `?{backgroundColor:${dVar}?${darkVar}:${lightVar},backgroundMaterial:null}:`;
  const patchedFunc = fullMatch.replace(win32Branch, `${linuxBranch}${win32Branch}`);
  return { source: source.replace(fullMatch, patchedFunc), patched: true };
}

const beforeMainSource = mainSource;
mainSource = patchPlatformChecks(mainSource);

const bgPatch = patchSurfaceBackgroundFunction(mainSource);

if (!bgPatch.patched) {
  if (mainSource.includes("===`linux`&&!") && mainSource.includes("backgroundMaterial:null}:")) {
    console.log(`${TAG}: main bundle appears already patched`);
  } else {
    fail("could not find BrowserWindow background color function in main bundle");
  }
} else {
  mainSource = bgPatch.source;

  if (!mainSource.includes("===`linux`&&!")) {
    fail("patch verification failed: linux branch not found after patching");
  }

  writeFileSync(mainFile, mainSource);
  console.log(`${TAG}: patched ${mainFile}`);
}

if (!bgPatch.patched && mainSource !== beforeMainSource) {
  writeFileSync(mainFile, mainSource);
  console.log(`${TAG}: patched Linux opaque-surface platform checks in ${mainFile}`);
}

// ---------- 2. Patch webview theme defaults ----------

if (!existsSync(webviewAssets) || !statSync(webviewAssets).isDirectory()) {
  console.log(`${TAG}: no webview/assets directory found, skipping theme patch`);
  process.exit(0);
}

const themeFiles = readdirSync(webviewAssets, { withFileTypes: true })
  .filter((e) => e.isFile() && e.name.endsWith(".js"))
  .map((e) => join(webviewAssets, e.name))
  .filter((f) => readFileSync(f, "utf8").includes("opaqueWindows:!1"));

let themePatched = 0;
for (const file of themeFiles) {
  let src = readFileSync(file, "utf8");
  const updated = src.replaceAll("opaqueWindows:!1", "opaqueWindows:!0");
  if (updated !== src) {
    writeFileSync(file, updated);
    themePatched++;
    console.log(`${TAG}: patched theme defaults in ${file}`);
  }
}

if (themePatched === 0 && themeFiles.length === 0) {
  console.log(`${TAG}: no theme files with opaqueWindows:!1 found (may already be patched)`);
} else {
  console.log(`${TAG}: patched ${themePatched} theme file(s)`);
}
