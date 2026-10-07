import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import test from "node:test";
import ts from "typescript";

const page = readFileSync("app/page.tsx", "utf8");

function declaration(source: string, marker: string) {
  const start = source.indexOf(marker);
  assert.notEqual(start, -1, `missing ${marker}`);
  const open = source.indexOf("{", start);
  assert.notEqual(open, -1, `missing body for ${marker}`);
  let depth = 0;
  for (let index = open; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`unterminated ${marker}`);
}

const fingerprintDeclaration = declaration(page, "function courseEditorFingerprint");
const backDeclaration = declaration(page, "const handlePageBack = () =>");

function exerciseCourseBack(changed: boolean, confirmResult: boolean) {
  const exports: Record<string, (...args: unknown[]) => unknown> = {};
  const source = `
    ${fingerprintDeclaration}
    exports.run = function(changed, confirmResult) {
      const original = { id: "course-1", name: "La Vista", builtIn: false, holes: [{ number: 1, par: 4, strokeIndex: 1 }] };
      const courseDraft = changed ? { ...original, name: "La Vista editado" } : original;
      const courseEditorInitialFingerprint = courseEditorFingerprint(original);
      const tab = "courses";
      let goBackCalls = 0;
      let confirmCalls = 0;
      const window = { confirm() { confirmCalls += 1; return confirmResult; } };
      function goBack() { goBackCalls += 1; }
      ${backDeclaration};
      handlePageBack();
      return { goBackCalls, confirmCalls };
    };
  `;
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(compiled, { exports });
  return exports.run(changed, confirmResult) as { goBackCalls: number; confirmCalls: number };
}

test("page-level top and bottom returns share handlePageBack, including the course editor", () => {
  assert.match(page, /showPageBack && <button[^>]*onClick=\{handlePageBack\}>← Regresar<\/button>/);
  assert.match(page, /showPageBack && tab !== "courses" && <BottomBackAction label="← Regresar" onBack=\{handlePageBack\} \/>/);
  assert.match(page, /tab === "courses"[\s\S]*<button className="secondary big" onClick=\{handlePageBack\}>← Regresar<\/button>/);
  assert.match(backDeclaration, /courseEditorFingerprint\(courseDraft\) !== courseEditorInitialFingerprint/);
  assert.match(backDeclaration, /window\.confirm\("Tienes cambios sin guardar\. ¿Salir sin guardarlos\?"\)/);
});

test("course editor rejects dirty exit when confirmation is denied and otherwise returns", () => {
  const rejected = exerciseCourseBack(true, false);
  assert.equal(rejected.goBackCalls, 0);
  assert.equal(rejected.confirmCalls, 1);

  const accepted = exerciseCourseBack(true, true);
  assert.equal(accepted.goBackCalls, 1);
  assert.equal(accepted.confirmCalls, 1);

  const clean = exerciseCourseBack(false, false);
  assert.equal(clean.goBackCalls, 1);
  assert.equal(clean.confirmCalls, 0);
});
