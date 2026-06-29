#!/usr/bin/env node
// SPDX-License-Identifier: MIT
//
// Adapted Linux core patches from ilysenko/codex-desktop-linux.
//
// This file intentionally ports only self-contained stability fixes that do
// not require ilysenko's packaging engine or extra runtime assets.

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const TAG = "patch-linux-ilysenko-core";
const appRoot = process.argv[2] ?? "app-extracted";
const buildRoot = join(appRoot, ".vite", "build");

function fail(message) {
  console.error(`${TAG}: ${message}`);
  process.exit(1);
}

function requireName(source, moduleName) {
  const escaped = moduleName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = source.match(new RegExp(`([A-Za-z_$][\\w$]*)=require\\(([\\\`"'])${escaped}\\2\\)`));
  return match?.[1] ?? null;
}

function findMainFile() {
  if (!existsSync(buildRoot) || !statSync(buildRoot).isDirectory()) {
    fail(`could not find Vite build directory: ${buildRoot}`);
  }
  const mainFiles = readdirSync(buildRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.startsWith("main-") && entry.name.endsWith(".js"))
    .map((entry) => join(buildRoot, entry.name));
  if (mainFiles.length !== 1) {
    fail(`expected one main-*.js bundle, found ${mainFiles.length}`);
  }
  return mainFiles[0];
}

function applyLinuxMenuPatch(source) {
  const menuRegex = /process\.platform===`win32`&&([A-Za-z_$][\w$]*)\.removeMenu\(\),/g;
  let changed = false;
  const patched = source.replace(menuRegex, (match, windowVar, offset) => {
    const linuxPatch = `process.platform===\`linux\`&&${windowVar}.setMenuBarVisibility(!1),`;
    const upgradedLinuxPatch = `process.platform===\`linux\`&&(${windowVar}.setMenuBarVisibility(!1),${windowVar}.removeMenu?.()),`;
    if (
      source.slice(Math.max(0, offset - linuxPatch.length), offset) === linuxPatch ||
      source.slice(Math.max(0, offset - upgradedLinuxPatch.length), offset) === upgradedLinuxPatch
    ) {
      return match;
    }
    changed = true;
    return `${linuxPatch}${match}`;
  });
  return { source: patched, changed };
}

function applyLinuxReadyToShowWindowStatePatch(source) {
  const alreadyPatchedRegex =
    /[A-Za-z_$][\w$]*&&[A-Za-z_$][\w$]*\.once\(`ready-to-show`,\(\)=>\{[A-Za-z_$][\w$]*\.isDestroyed\(\)\|\|[A-Za-z_$][\w$]*\.maximize\(\)\}\)/;
  if (alreadyPatchedRegex.test(source)) {
    return { source, changed: false };
  }

  const readyToShowMaximizeRegex =
    /([A-Za-z_$][\w$]*)\.once\(`ready-to-show`,\(\)=>\{\1\.isDestroyed\(\)\|\|\1\.maximize\(\)\}\)/g;
  let changed = false;
  const patched = source.replace(readyToShowMaximizeRegex, (_match, windowVar, offset, sourceText) => {
    const prefix = sourceText.slice(Math.max(0, offset - 120), offset);
    const maximizedStateVar =
      prefix.match(/([A-Za-z_$][\w$]*)&&process\.platform===`linux`&&[A-Za-z_$][\w$]*\.setIcon\(/)?.[1] ??
      "false";
    changed = true;
    return `${maximizedStateVar}&&${windowVar}.once(\`ready-to-show\`,()=>{${windowVar}.isDestroyed()||${windowVar}.maximize()})`;
  });
  return { source: patched, changed };
}

function applyLinuxResizeRepaintPatch(source) {
  const helperName = "codexLinuxInstallResizeRepaintHook";
  if (source.includes(`function ${helperName}(`)) {
    return { source, changed: false };
  }

  const helper =
    "function codexLinuxInstallResizeRepaintHook(e){if(!(process.platform===`linux`)||e.__codexLinuxResizeRepaintHookInstalled)return;e.__codexLinuxResizeRepaintHookInstalled=!0;let __codexResizeRepaintScheduled=!1,__codexResizeRepaint=()=>{__codexResizeRepaintScheduled||(__codexResizeRepaintScheduled=!0,setTimeout(()=>{if(__codexResizeRepaintScheduled=!1,e.isDestroyed())return;let __codexWebContents=e.webContents;__codexWebContents==null||__codexWebContents.isDestroyed?.()||typeof __codexWebContents.invalidate==`function`&&__codexWebContents.invalidate()},16))};e.on(`resize`,__codexResizeRepaint),e.on(`resized`,__codexResizeRepaint)}";
  const readyToShowRegex =
    /(^|[^A-Za-z0-9_$])((?:[A-Za-z_$][\w$]*&&)?)([A-Za-z_$][\w$]*)\.once\(`ready-to-show`,\(\)=>\{/g;
  let changed = false;
  const patched = source.replace(
    readyToShowRegex,
    (match, leading, guardPrefix, windowVar, offset, sourceText) => {
      const linuxPatch = `process.platform===\`linux\`&&${helperName}(${windowVar}),`;
      const insertionPoint = offset + leading.length;
      const prefix = sourceText.slice(Math.max(0, insertionPoint - Math.max(400, linuxPatch.length * 2)), insertionPoint);
      if (prefix.includes(linuxPatch)) {
        return match;
      }
      changed = true;
      return `${leading}${linuxPatch}${guardPrefix}${windowVar}.once(\`ready-to-show\`,()=>{`;
    },
  );

  if (!changed) {
    return { source, changed: false };
  }
  if (patched.startsWith('"use strict";')) {
    return { source: `"use strict";${helper}${patched.slice('"use strict";'.length)}`, changed: true };
  }
  return { source: `${helper}${patched}`, changed: true };
}

function applyLinuxGitOriginsSourceFallbackPatch(source) {
  const fallbackSource = "linux_git_origins_missing_source_fallback";
  if (source.includes(`source:\`${fallbackSource}\`,requestKind:`)) {
    return { source, changed: false };
  }

  const dynamicRegex =
    /if\(([A-Za-z_$][\w$]*)==null\)\{if\(([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(([A-Za-z_$][\w$]*)\)\)throw Error\(`Missing git operation source for \$\{\4\}`\);return ([A-Za-z_$][\w$]*)\(\)\}return ([A-Za-z_$][\w$]*)\.([A-Za-z_$][\w$]*)\(\{source:\1,requestKind:\4\},\5\)/;
  const match = source.match(dynamicRegex);
  if (match == null) {
    return { source, changed: false };
  }
  const [, sourceVar, gitGuardVar, guardFn, requestKindVar, callVar, operationContextVar, operationContextFn] = match;
  return {
    source: source.replace(
      dynamicRegex,
      `if(${sourceVar}==null){if(${gitGuardVar}.${guardFn}(${requestKindVar})){if(${requestKindVar}===\`git-origins\`)return ${operationContextVar}.${operationContextFn}({source:\`${fallbackSource}\`,requestKind:${requestKindVar}},${callVar});throw Error(\`Missing git operation source for \${${requestKindVar}}\`)}return ${callVar}()}return ${operationContextVar}.${operationContextFn}({source:${sourceVar},requestKind:${requestKindVar}},${callVar})`,
    ),
    changed: true,
  };
}

function applyLinuxXdgDocumentsDirPatch(source) {
  if (source.includes("codexLinuxXdgDocumentsDir")) {
    return { source, changed: false };
  }

  const fsVar = requireName(source, "node:fs");
  if (fsVar == null) {
    return { source, changed: false };
  }

  const documentsDirRegex =
    /function ([A-Za-z_$][\w$]*)\(\{desktopPaths:([A-Za-z_$][\w$]*),homeDir:([A-Za-z_$][\w$]*),platform:([A-Za-z_$][\w$]*)\}\)\{return ([A-Za-z_$][\w$]*)\(\3,\2\.getPath\(`home`\),\4\)\?\2\.getPath\(`documents`\):([A-Za-z_$][\w$]*)\(\4\)\.join\(\3,`Documents`\)\}/u;
  const match = source.match(documentsDirRegex);
  if (match == null) {
    return { source, changed: false };
  }

  const [, fnName, desktopPathsVar, homeDirVar, platformVar, sameHomeFn, pathFactoryFn] = match;
  const helper = [
    "function codexLinuxXdgDocumentsDir({fs:e,homeDir:t,path:n}){try{",
    "let r=process.env.XDG_CONFIG_HOME?.trim(),i=r&&n.isAbsolute(r)?n.join(r,`user-dirs.dirs`):n.join(t,`.config`,`user-dirs.dirs`);",
    "if(!e.existsSync(i))return null;",
    "let a=e.readFileSync(i,`utf8`).match(/^XDG_DOCUMENTS_DIR=([\"'])(.*)\\1/m);",
    "if(a==null)return null;",
    "let o=a[2].replace(/\\\\(.)/g,`$1`);",
    "if(o===`$HOME`)return t;",
    "if(o.startsWith(`$HOME/`))return n.join(t,o.slice(6));",
    "if(o.startsWith(`~/`))return n.join(t,o.slice(2));",
    "return n.isAbsolute(o)?o:n.join(t,o)",
    "}catch{return null}}",
  ].join("");
  const patchedFn =
    `${helper}function ${fnName}({desktopPaths:${desktopPathsVar},homeDir:${homeDirVar},platform:${platformVar}}){` +
    `if(${platformVar}===\`linux\`){let __codexLinuxDocumentsDir=codexLinuxXdgDocumentsDir({fs:${fsVar},homeDir:${homeDirVar},path:${pathFactoryFn}(${platformVar})});` +
    "if(__codexLinuxDocumentsDir!=null)return __codexLinuxDocumentsDir}" +
    `return ${sameHomeFn}(${homeDirVar},${desktopPathsVar}.getPath(\`home\`),${platformVar})?${desktopPathsVar}.getPath(\`documents\`):${pathFactoryFn}(${platformVar}).join(${homeDirVar},\`Documents\`)}`;

  return { source: source.replace(documentsDirRegex, () => patchedFn), changed: true };
}

const mainFile = findMainFile();
let source = readFileSync(mainFile, "utf8");
const patchers = [
  ["menu visibility", applyLinuxMenuPatch],
  ["ready-to-show window state", applyLinuxReadyToShowWindowStatePatch],
  ["resize repaint", applyLinuxResizeRepaintPatch],
  ["git origins source fallback", applyLinuxGitOriginsSourceFallbackPatch],
  ["XDG documents dir", applyLinuxXdgDocumentsDirPatch],
];

const applied = [];
for (const [name, patcher] of patchers) {
  const result = patcher(source);
  if (result.changed) {
    source = result.source;
    applied.push(name);
  }
}

if (applied.length > 0) {
  writeFileSync(mainFile, source);
}

if (applied.length === 0) {
  console.log(`${TAG}: no core patches applied (already patched or not applicable)`);
} else {
  console.log(`${TAG}: applied ${applied.join(", ")}`);
}
