// Pieces every workflow generator (scripts/build-*-workflow.mjs) needs, kept in one place: repo paths, the step that
// turns a tested library file into plain Code-node text, node id and Code-node factories, the "is true" If condition and
// the write-or-check step. Each generator keeps whatever is its own (its glue, its nodes, its settings).
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const rel = (...p) => path.join(root, ...p);
export const readText = (...p) => fs.readFileSync(rel(...p), 'utf8').replace(/\r\n/g, '\n');
export const readJson = (...p) => JSON.parse(readText(...p));

// A tested library file becomes Code-node text by dropping its module syntax. A file that still has any left after that
// would fail inside n8n, so it fails here instead.
function stripModuleSyntax(src, file) {
  const out = src
    .replace(/^'use strict';\n/m, '')
    .replace(/^const \{[^}]*\} = require\('[^']+'\);\n/gm, '')
    .replace(/^module\.exports = \{[^}]*\};\n?$/gm, '');
  if (/\brequire\(|module\.exports|\bexports\./.test(out)) throw new Error(file + ' still has module syntax after stripping');
  return out.trim() + '\n';
}

// The library files joined in the order given. A file may only use names from the files above it.
export const libText = (files) => files.map((f) => '// ---- ' + f + ' ----\n' + stripModuleSyntax(readText(f), f)).join('\n');

// Node ids: the same 12 digits every time for one workflow, so a rebuild never changes an id. `prefix` is two digits, one
// per workflow, so no two workflows in the folder share an id.
export const nodeIds = (prefix) => (n) => '00000000-0000-4000-8000-00000000' + prefix + String(n).padStart(2, '0');

// An If node condition that passes when the expression is true.
export const ifTrue = (expr) => ({
  conditions: {
    options: { caseSensitive: true, leftValue: '', typeValidation: 'strict', version: 2 },
    conditions: [{ id: 'c1', leftValue: expr, rightValue: '', operator: { type: 'boolean', operation: 'true', singleValue: true } }],
    combinator: 'and'
  },
  options: {}
});

// Code node makers for one workflow: `code` runs once per item, `codeAll` once for all items.
export function codeNodes(ID) {
  const make = (mode) => (id, name, pos, jsCode) => ({ id: ID(id), name, type: 'n8n-nodes-base.code', typeVersion: 2, position: pos, parameters: { mode, language: 'javaScript', jsCode } });
  return { code: make('runOnceForEachItem'), codeAll: make('runOnceForAllItems') };
}

// True when the file is being run from the command line, not imported by a test.
export const isMain = (metaUrl) => !!process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(metaUrl);

// targets: [[repo-relative file, build function], ...]. Writes each file, or with --check only compares it to the one on disk
// and exits 1 if any differs. `script` is the generator's file name, for the messages.
export function writeOrCheck(targets, script) {
  const check = process.argv.includes('--check');
  let stale = false;
  for (const [file, build] of targets) {
    const workflow = build();
    const text = JSON.stringify(workflow, null, 2) + '\n';
    const target = rel(file);
    if (check) {
      const current = fs.existsSync(target) ? fs.readFileSync(target, 'utf8').replace(/\r\n/g, '\n') : '';
      if (current !== text) { console.error(file + ' is out of date. Run: node scripts/' + script); stale = true; }
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, text);
      console.log('wrote ' + file + ' (' + workflow.nodes.length + ' nodes, ' + text.length + ' characters)');
    }
  }
  if (check) {
    if (stale) process.exit(1);
    console.log(script + ': generated files are up to date');
  }
}
