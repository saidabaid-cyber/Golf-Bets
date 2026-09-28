import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("global modal shell constrains GHIN, round and confirmation dialogs at 390/430px", () => {
  const css = readFileSync("app/globals.css", "utf8");
  const ghinCss = readFileSync("app/components/ghin-read-only-panel.module.css", "utf8");
  const shell = readFileSync("app/components/modal-shell.tsx", "utf8");
  const ghin = readFileSync("app/components/ghin-read-only-panel.tsx", "utf8");
  const round = readFileSync("app/components/round-setup-wizard.tsx", "utf8");
  assert.match(shell, /className="modalBackdrop"/);
  assert.match(css, /\.modalBackdrop\{width:100%;max-width:100vw;min-width:0/);
  assert.match(css, /\.modalBackdrop>section,[^{]+\{width:min\(100%,430px\);max-width:100%;min-width:0;box-sizing:border-box;overflow-x:hidden/);
  assert.match(css, /\.modalBackdrop input,[^{]+\{max-width:100%;min-width:0;box-sizing:border-box/);
  assert.match(css, /@media\(max-width:430px\)\{\.modalBackdrop/);
  assert.match(css, /safe-area-inset-left/);
  assert.match(css, /\.confirmDialog\{position:relative;/);
  assert.match(css, /\.modalBackdrop button\.modalCloseButton\{position:absolute;[^}]*width:44px;min-width:44px;max-width:44px;height:44px;min-height:44px;max-height:44px;[^}]*flex:0 0 44px;[^}]*padding:0;[^}]*border-radius:50%/);
  assert.doesNotMatch(css, /\.modalCloseButton\{[^}]*margin:0 0 -44px auto/);
  assert.match(css, /\.modalCloseButton~form>h2,[^{]+\{min-width:0;padding-right:56px;overflow-wrap:anywhere\}/);
  assert.match(ghin, /<ModalShell open=\{authMode !== null\}/);
  assert.match(round, /<ModalShell open=\{confirmExit\}/);
  assert.match(css, /\.confirmDialog \.dialogActions button\{width:100%;min-width:0;white-space:normal\}/);
  assert.doesNotMatch(ghinCss, /min-width:\s*min\(28rem,\s*calc\(100vw - 3rem\)\)/);
  assert.match(ghinCss, /\.authForm, \.confirmIdentity \{ display: grid; width: 100%; min-width: 0; max-width: 100%;/);
  assert.match(ghinCss, /\.details dt, \.details dd \{ min-width: 0; max-width: 100%; overflow-wrap: anywhere;/);
  assert.match(ghinCss, /\.actions button \{ min-width: 0; max-width: 100%; min-height: 44px; white-space: normal; overflow-wrap: anywhere;/);
  assert.match(ghinCss, /@media \(max-width: 430px\)[\s\S]*\.actions button \{ width: 100%; \}/);
});

test("account data dialogs share the same no-overflow contract", () => {
  const css = readFileSync("app/components/profile-data-dialogs.module.css", "utf8");
  assert.match(css, /max-width:100%; min-width:0/);
  assert.match(css, /overflow-x:hidden/);
  assert.match(css, /@media\(max-width:430px\)/);
});
