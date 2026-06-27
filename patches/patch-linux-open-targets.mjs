#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Patches the Codex desktop app to support "Open in Editor/File Manager" on Linux.
//
// This patch identifies the "open-in-targets" registry in the main process
// bundle and adds Linux-specific handlers for:
//   - VS Code (stable/insiders)
//   - Cursor
//   - Windsurf
//   - Zed
//   - System File Manager (xdg-open)

import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "patch-linux-open-targets";
const appRoot = process.argv[2] ?? "app-extracted";
const buildRoot = join(appRoot, ".vite", "build");

function fail(message) {
  console.error(`${TAG}: ${message}`);
  process.exit(1);
}

if (!existsSync(buildRoot) || !statSync(buildRoot).isDirectory()) {
  fail(`could not find Vite build directory: ${buildRoot}`);
}

const requiredMarkers = [
  "id:`vscode`",
  "id:`vscodeInsiders`",
  "id:`cursor`",
  "id:`windsurf`",
  "id:`zed`",
  "id:`fileManager`",
];

function hasOpenTargetsSection(source) {
  return (
    source.includes("open-in-targets") &&
    requiredMarkers.every((marker) => source.includes(marker))
  );
}

const oldRegistryPattern =
  /var ([A-Za-z_$][\w$]*)=\[((?:[A-Za-z_$][\w$]*,?)+)\],([A-Za-z_$][\w$]*)=([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(`open-in-targets`\);?/;

const arrayRegistryPattern =
  /var ([A-Za-z_$][\w$]*)=\[((?:[A-Za-z_$][\w$]*,?)+)\];[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\(`open-in-targets`\);function [A-Za-z_$][\w$]*\(e\)\{return \1\.flatMap/;

const mapRegistryPattern =
  /var ([A-Za-z_$][\w$]*)=new Map\(\[((?:[A-Za-z_$][\w$]*,?)+)\]\.flatMap\(e=>\{let t=e\.platforms\[process\.platform\];return t==null\?\[\]:\[\[e\.id,\{id:e\.id,\.\.\.t\}\]\]\}\)\);/;

const targetFiles = readdirSync(buildRoot, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".js"))
  .map((entry) => join(buildRoot, entry.name))
  .filter((file) => hasOpenTargetsSection(readFileSync(file, "utf8")));

if (targetFiles.length === 0) {
  fail("expected at least one open-in-targets bundle, found 0");
}

function findCodeArgsName(source) {
  const markerIndex = source.indexOf("darwinArgs:");
  const factoryChunk =
    markerIndex >= 0 ? source.slice(Math.max(0, markerIndex - 500), markerIndex + 2000) : "";
  const factoryMatch = factoryChunk.match(/args:[A-Za-z_$][\w$]*\?\?([A-Za-z_$][\w$]*)/);
  if (factoryMatch) {
    return factoryMatch[1];
  }

  // Older bundles inlined the helper instead of routing it through the target factory.
  const vscodeIndex = source.indexOf("id:`vscode`");
  const inlineChunk =
    vscodeIndex >= 0 ? source.slice(Math.max(0, vscodeIndex - 20000), vscodeIndex + 2000) : source;
  const inlineMatch = inlineChunk.match(
    /(?:var |,)?(?:function\s+([A-Za-z_$][\w$]*)\s*\((?:\{hostConfig:[^}]+\}|[^)]+)\)|([A-Za-z_$][\w$]*)\s*=\s*\((?:\{hostConfig:[^}]+\}|[^)]+)\)\s*=>)\s*\{[\s\S]*?hostConfig:[^,]+,remoteWorkspaceRoot:[^,]+,remotePath:[^,]+,location:[^}]+\}/,
  );
  return inlineMatch?.[1] || inlineMatch?.[2] || null;
}

function findOpenPathName(source) {
  const markerIndex = source.indexOf("id:`systemDefault`");
  const chunk =
    markerIndex >= 0 ? source.slice(Math.max(0, markerIndex - 500), markerIndex + 2500) : source;
  const systemDefaultMatch = chunk.match(
    /linux:\{detect:\(\)=>`system-default`[\s\S]*?open:async\(\{path:([A-Za-z_$][\w$]*)\}\)=>\s*([A-Za-z_$][\w$]*)\(\1\)/,
  );
  if (systemDefaultMatch) {
    return systemDefaultMatch[2];
  }

  const openPathMatch = chunk.match(
    /(?:async\s+function\s+([A-Za-z_$][\w$]*)\s*\([^)]+\)|([A-Za-z_$][\w$]*)\s*=\s*async\s*\([^)]+\)\s*=>)\s*\{[\s\S]*?await\s+[A-Za-z_$][\w$]*\.shell\.openPath\([^)]+\)[\s\S]*?throw\s+Error\([^)]+\)\}/,
  );
  return openPathMatch?.[1] || openPathMatch?.[2] || null;
}

function findModuleAliases(source, codeArgsName) {
  const helperIndex = Math.max(
    source.indexOf(`function ${codeArgsName}`),
    source.indexOf(`var ${codeArgsName}=`),
    source.indexOf(`,${codeArgsName}=`),
  );
  const chunkStart = helperIndex >= 0 ? Math.max(0, helperIndex - 5000) : 0;
  const chunkEnd = helperIndex >= 0 ? Math.min(source.length, helperIndex + 5000) : source.length;
  const chunk = source.slice(chunkStart, chunkEnd);
  const aliasesMatch = chunk.match(
    /for\(let e of [A-Za-z_$][\w$]*\)\{let [A-Za-z_$][\w$]*;try\{[A-Za-z_$][\w$]*=[A-Za-z_$][\w$]*\(\(0,([A-Za-z_$][\w$]*)\.readdirSync\)\(e\)\)\}catch\{continue\}[\s\S]*?\(0,([A-Za-z_$][\w$]*)\.join\)/,
  );
  if (aliasesMatch) {
    return { fs: aliasesMatch[1], path: aliasesMatch[2] };
  }

  const fallbackMatch = source.match(
    /\(0,([A-Za-z_$][\w$]*)\.existsSync\)\([^)]+\)[\s\S]{0,1500}?\(0,([A-Za-z_$][\w$]*)\.join\)/,
  );
  if (fallbackMatch) {
    return { fs: fallbackMatch[1], path: fallbackMatch[2] };
  }

  return null;
}

function findArrayRegistryMatch(source) {
  let markerIndex = -1;
  while ((markerIndex = source.indexOf("`open-in-targets`);function ", markerIndex + 1)) >= 0) {
    const chunk = source.slice(Math.max(0, markerIndex - 1200), markerIndex + 300);
    const match = chunk.match(arrayRegistryPattern);
    if (match) {
      return match;
    }
  }
  return null;
}

function findMapRegistryMatch(source) {
  let markerIndex = -1;
  while ((markerIndex = source.indexOf(".flatMap(e=>{let t=e.platforms[process.platform]", markerIndex + 1)) >= 0) {
    const chunk = source.slice(Math.max(0, markerIndex - 1200), markerIndex + 300);
    const match = chunk.match(mapRegistryPattern);
    if (match) {
      return match;
    }
  }
  return null;
}

function findOldRegistryMatch(source) {
  let markerIndex = -1;
  while ((markerIndex = source.indexOf("`open-in-targets`)", markerIndex + 1)) >= 0) {
    const chunk = source.slice(Math.max(0, markerIndex - 1200), markerIndex + 200);
    const match = chunk.match(oldRegistryPattern);
    if (match) {
      return match;
    }
  }
  return null;
}

function buildLinuxPatch({ codeArgsName, openPathName, fsAlias, pathAlias }) {
  const linuxPatch = [
    `function linuxResolveAbsoluteCommand(e){if(!(0,${pathAlias}.isAbsolute)(e))return null;try{let t=(0,${fsAlias}.statSync)(e);return t.isFile()?e:null}catch{return null}}`,
    `function linuxPathSearch(e){if(!e)return null;if(e.includes(\`/\`))return linuxResolveAbsoluteCommand(e);for(let t of(process.env.PATH??\`\`).split(\`:\`)){if(!t)continue;let n=linuxResolveAbsoluteCommand((0,${pathAlias}.join)(t,e));if(n)return n}return null}`,
    `function linuxHomeDir(){return process.env.HOME?.trim()||\`\`}`,
    `function linuxDesktopEntrySearchRoots(){let e=linuxHomeDir();return[e?(0,${pathAlias}.join)(e,\`.local\`,\`share\`,\`applications\`):null,\`/usr/share/applications\`].filter(Boolean)}`,
    `function linuxOpenTargetSearchRoots(){let e=linuxHomeDir();return[e?(0,${pathAlias}.join)(e,\`Applications\`):null,e?(0,${pathAlias}.join)(e,\`Downloads\`):null,\`/opt\`].filter(Boolean)}`,
    "function linuxSplitDesktopExec(e){return e.match(/\"([^\"\\\\]*(?:\\\\.[^\"\\\\]*)*)\"|'([^']*)'|\\S+/g)?.map(e=>e.replace(/^\"|\"$/g,``).replace(/^'|'$/g,``))??[]}",
    "function linuxResolveDesktopExec(e){let t=linuxSplitDesktopExec(e.replace(/%.?/g,``).trim());for(;t[0]===`env`;){t.shift();for(;t[0]?.includes(`=`)&&!t[0].startsWith(`/`);)t.shift()}let n=t[0];if(!n)return null;return linuxResolveAbsoluteCommand(n)??linuxPathSearch(n)}",
    `function linuxFindDesktopEntryExec(e){let t=e.map(e=>e.toLowerCase());for(let e of linuxDesktopEntrySearchRoots()){let n;try{n=(0,${fsAlias}.readdirSync)(e)}catch{continue}for(let r of n){let a=r.toLowerCase();if(!a.endsWith(\`.desktop\`)||!t.some(e=>a.includes(e)))continue;let s=(0,${pathAlias}.join)(e,r),c=null;try{c=(0,${fsAlias}.readFileSync)(s,\`utf8\`)}catch{continue}let l=c.match(/^Exec=(.+)$/m)?.[1]?.trim();if(!l)continue;let u=linuxResolveDesktopExec(l.replace(/%.?/g,\`\`).trim());if(u)return u}}return null}`,
    `function linuxFindAppImage(e){let t=e.map(e=>e.toLowerCase());for(let e of linuxOpenTargetSearchRoots()){let n;try{n=(0,${fsAlias}.readdirSync)(e,{withFileTypes:!0})}catch{continue}for(let r of n){if(!r.isFile())continue;let n=r.name.toLowerCase();if(!n.endsWith(\`.appimage\`)||!t.some(e=>n.includes(e)))continue;let a=linuxResolveAbsoluteCommand((0,${pathAlias}.join)(e,r.name));if(a)return a}}return null}`,
    "function linuxResolveEditorTarget(e,t=[],n=[]){for(let t of e){let e=linuxPathSearch(t);if(e)return e}for(let e of t){let t=linuxResolveAbsoluteCommand(e);if(t)return t}let r=n.length>0?linuxFindDesktopEntryExec(n):null;return r??(n.length>0?linuxFindAppImage(n):null)}",
    "function linuxFileManagerDetect(){return linuxPathSearch(`xdg-open`)??linuxResolveAbsoluteCommand(`/usr/bin/xdg-open`)}",
    `function linuxOpenFileManagerPath(e){let t=e;for(;;){if((0,${fsAlias}.existsSync)(t))break;let e=(0,${pathAlias}.dirname)(t);if(e===t){t=null;break}t=e}let n=t??e;if((0,${fsAlias}.existsSync)(n)&&(0,${fsAlias}.statSync)(n).isFile())n=(0,${pathAlias}.dirname)(n);return ${openPathName}(n)}`,
    "function linuxZedArgs(e,t){return t?[`${e}:${t.line}:${t.column}`]:[e]}",
    `var linuxVscode={id:\`vscode\`,platforms:{linux:{label:\`VS Code\`,icon:\`apps/vscode.png\`,kind:\`editor\`,detect:()=>linuxResolveEditorTarget([\`code\`,\`code-oss\`],[\`/usr/bin/code\`,\`/usr/bin/code-oss\`,\`/snap/bin/code\`],[\`visual studio code\`,\`code\`,\`code-oss\`]),args:${codeArgsName},supportsSsh:!0}}},`,
    `linuxVscodeInsiders={id:\`vscodeInsiders\`,platforms:{linux:{label:\`VS Code Insiders\`,icon:\`apps/vscode-insiders.png\`,kind:\`editor\`,detect:()=>linuxResolveEditorTarget([\`code-insiders\`],[\`/usr/bin/code-insiders\`,\`/snap/bin/code-insiders\`],[\`insiders\`,\`code-insiders\`]),args:${codeArgsName},supportsSsh:!0}}},`,
    `linuxCursor={id:\`cursor\`,platforms:{linux:{label:\`Cursor\`,icon:\`apps/cursor.png\`,kind:\`editor\`,detect:()=>linuxResolveEditorTarget([\`cursor\`],[\`/usr/bin/cursor\`,\`/opt/Cursor/cursor\`,\`/opt/Cursor/cursor\`],[\`cursor\`]),args:${codeArgsName},supportsSsh:!0}}},`,
    `linuxWindsurf={id:\`windsurf\`,platforms:{linux:{label:\`Windsurf\`,icon:\`apps/windsurf.png\`,kind:\`editor\`,detect:()=>linuxResolveEditorTarget([\`windsurf\`],[\`/usr/bin/windsurf\`,\`/opt/Windsurf/windsurf\`,\`/opt/Windsurf/windsurf\`],[\`windsurf\`]),args:${codeArgsName},supportsSsh:!0}}},`,
    "linuxZed={id:`zed`,platforms:{linux:{label:`Zed`,icon:`apps/zed.png`,kind:`editor`,detect:()=>linuxResolveEditorTarget([`zed`],[`/usr/bin/zed`,`/opt/zed/zed`,`/opt/Zed/zed`],[`zed`]),args:linuxZedArgs}}},",
    "linuxFileManager={id:`fileManager`,platforms:{linux:{label:`File Manager`,icon:`apps/file-explorer.png`,kind:`fileManager`,detect:linuxFileManagerDetect,args:e=>[e],open:async({path:e})=>linuxOpenFileManagerPath(e)}}};",
  ].join("");

  const linuxTargets = [
    "linuxVscode",
    "linuxVscodeInsiders",
    "linuxCursor",
    "linuxWindsurf",
    "linuxZed",
    "linuxFileManager",
  ].join(",");

  return { linuxPatch, linuxTargets };
}

function patchSource(source, targetFile) {
  if (source.includes("function linuxResolveEditorTarget(")) {
    console.log(`${TAG}: bundle appears already patched: ${targetFile}`);
    return source;
  }

  const codeArgsName = findCodeArgsName(source);
  if (!codeArgsName) {
    fail(`could not find VS Code-compatible open-target args helper in ${targetFile}`);
  }

  const openPathName = findOpenPathName(source);
  if (!openPathName) {
    fail(`could not find Electron shell.openPath helper in ${targetFile}`);
  }

  const aliases = findModuleAliases(source, codeArgsName);
  if (!aliases) {
    fail(`could not find fs/path aliases in ${targetFile}`);
  }

  const { linuxPatch, linuxTargets } = buildLinuxPatch({
    codeArgsName,
    openPathName,
    fsAlias: aliases.fs,
    pathAlias: aliases.path,
  });

  const arrayRegistryMatch = findArrayRegistryMatch(source);
  if (arrayRegistryMatch) {
    const [registrySource, registryName, registryEntries] = arrayRegistryMatch;
    const replacement = registrySource.replace(
      `var ${registryName}=[${registryEntries}]`,
      `${linuxPatch}var ${registryName}=[${linuxTargets},${registryEntries}]`,
    );
    return source.replace(registrySource, replacement);
  }

  const mapRegistryMatch = findMapRegistryMatch(source);
  if (mapRegistryMatch) {
    const [registrySource, registryName, registryEntries] = mapRegistryMatch;
    const replacement = registrySource.replace(
      `var ${registryName}=new Map([${registryEntries}]`,
      `${linuxPatch}var ${registryName}=new Map([${registryEntries},${linuxTargets}]`,
    );
    return source.replace(registrySource, replacement);
  }

  const oldRegistryMatch = findOldRegistryMatch(source);
  if (oldRegistryMatch) {
    const [registrySource, registryName, registryEntries, loggerName, loggerObj, loggerFactory] =
      oldRegistryMatch;
    const replacement = `${linuxPatch}var ${registryName}=[${linuxTargets},${registryEntries}],${loggerName}=${loggerObj}.${loggerFactory}(\`open-in-targets\`);`;
    return source.replace(registrySource, replacement);
  }

  fail(`could not find open-in-targets registry declaration in ${targetFile}`);
}

let patchedCount = 0;
for (const targetFile of targetFiles) {
  const original = readFileSync(targetFile, "utf8");
  const patched = patchSource(original, targetFile);

  for (const marker of ["linuxResolveEditorTarget", "linuxFileManager", "code-oss"]) {
    if (!patched.includes(marker)) {
      fail(`patch verification failed for ${targetFile}; missing marker after patch: ${marker}`);
    }
  }

  if (patched !== original) {
    writeFileSync(targetFile, patched);
    patchedCount += 1;
    console.log(`${TAG}: patched ${targetFile}`);
  }
}

if (patchedCount === 0) {
  console.log(`${TAG}: all matching bundles already patched`);
}
