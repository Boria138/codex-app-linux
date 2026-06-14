#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "patch-linux-window";
const appRoot = process.argv[2] ?? "app-extracted";
const buildRoot = join(appRoot, ".vite", "build");

if (!existsSync(buildRoot) || !statSync(buildRoot).isDirectory()) {
  console.error(`${TAG}: could not find Vite build directory: ${buildRoot}`);
  process.exit(1);
}

const mainFile = readdirSync(buildRoot).find(f => f.startsWith("main-") && f.endsWith(".js"));
if (!mainFile) {
  console.error(`${TAG}: main bundle not found`);
  process.exit(1);
}

const filePath = join(buildRoot, mainFile);
let source = readFileSync(filePath, "utf8");
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
const fileIconRegex = /\.app\.getFileIcon\(([^()]+),\{size:process\.platform===`win32`\?`large`:`normal`\}\)/g;
if (fileIconRegex.test(source)) {
  source = source.replace(fileIconRegex, match => `process.platform===\`linux\`?Promise.resolve(null):${match}`);
  console.log(`${TAG}: patched about dialog file icon`);
  patched = true;
}

if (patched) {
  writeFileSync(filePath, source);
}
