#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "patch-linux-single-instance";
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

// Single Instance Lock
const readyNeedle = "await n.app.whenReady()";
const singleInstancePatch = "if(process.platform===`linux`&&!n.app.requestSingleInstanceLock()){n.app.quit();return}";

if (source.includes(readyNeedle) && !source.includes("requestSingleInstanceLock")) {
  source = source.replace(readyNeedle, `${singleInstancePatch};${readyNeedle}`);
  writeFileSync(filePath, source);
  console.log(`${TAG}: patched single instance lock`);
} else {
  console.log(`${TAG}: single instance lock marker not found or already patched`);
}
