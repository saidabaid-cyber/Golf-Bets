import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { createRequire } from "node:module";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
const realRequire = createRequire(resolve("package.json"));
const cache = new Map<string, Record<string, any>>();
/** Runs the real React SSR renderer against app TSX, with CSS as the only UI stub. */
export function careerModule(relative: string): Record<string, any> {
  const file = resolve(relative);
  if (cache.has(file)) return cache.get(file)!;
  const exports: Record<string, any> = {}; cache.set(file, exports);
  const source = ts.transpileModule(readFileSync(file, "utf8"), { fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  runInNewContext(source, { exports, URL, URLSearchParams, Date, Set, Map, Object, Number, Math, Intl, console, require(id: string) {
    if (id.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    if (!id.startsWith(".")) return realRequire(id);
    const path = resolve(dirname(file), id);
    if (path.endsWith(".json") && existsSync(path)) return JSON.parse(readFileSync(path, "utf8"));
    for (const suffix of [".ts", ".tsx", ".json"]) if (existsSync(path + suffix)) return suffix === ".json" ? JSON.parse(readFileSync(path + suffix, "utf8")) : careerModule(path + suffix);
    throw new Error(`Unknown career import: ${id}`);
  } });
  return exports;
}
export const renderCareer = (file: string, name: string, props: Record<string, unknown>) => renderToStaticMarkup(React.createElement(careerModule(file)[name], props));
