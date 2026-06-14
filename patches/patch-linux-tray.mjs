#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "patch-linux-tray";
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

// Enable System Tray for Linux
// Target: process.platform!==`win32`&&process.platform!==`darwin`?null:new n.Tray
const trayGuardRegex = /process\.platform!==`win32`&&process\.platform!==`darwin`\?null:/g;
if (trayGuardRegex.test(source)) {
  source = source.replace(trayGuardRegex, "process.platform!==`win32`&&process.platform!==`darwin`&&process.platform!==`linux`?null:");
  writeFileSync(filePath, source);
  console.log(`${TAG}: enabled system tray support for Linux`);
} else {
  console.log(`${TAG}: tray platform guard not found (already patched?)`);
}
