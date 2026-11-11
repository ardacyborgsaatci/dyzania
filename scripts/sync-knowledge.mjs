// Copies the shared knowledge base (knowledge/*.md) to the places that need their own copy:
//   - voice/knowledge/            (the voice agent bundles its own folder on Vercel)
//   - the "## Knowledge base" block inside the Draft Reply prompt of the support Core workflow
// Usage: node scripts/sync-knowledge.mjs          write the copies
//        node scripts/sync-knowledge.mjs --check  exit 1 if any copy is out of date
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const check = process.argv.includes("--check");
const src = path.join(root, "knowledge");
const files = fs.readdirSync(src).filter((f) => f.endsWith(".md")).sort();
const stale = [];

// 1. voice copy
const dest = path.join(root, "voice", "knowledge");
fs.mkdirSync(dest, { recursive: true });
for (const f of files) {
  const want = fs.readFileSync(path.join(src, f), "utf8");
  const p = path.join(dest, f);
  const have = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  if (have !== want) { stale.push("voice/knowledge/" + f); if (!check) fs.writeFileSync(p, want); }
}
for (const f of fs.readdirSync(dest)) {
  if (/\.(md|txt)$/.test(f) && !files.includes(f)) { stale.push("voice/knowledge/" + f + " (extra)"); if (!check) fs.unlinkSync(path.join(dest, f)); }
}

// 2. support Core draft prompt
const wfPath = path.join(root, "automations", "support", "workflows", "triage-core.json");
const wf = JSON.parse(fs.readFileSync(wfPath, "utf8"));
const kb = files.map((f) => fs.readFileSync(path.join(src, f), "utf8").trim()).join("\n\n");
const MARK = "## Knowledge base\n";
let hits = 0;
(function walk(o) {
  if (!o || typeof o !== "object") return;
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === "string" && v.includes(MARK)) {
      const next = v.slice(0, v.indexOf(MARK) + MARK.length) + kb;
      hits++;
      if (next !== v) { stale.push("support triage-core.json draft prompt"); o[k] = next; }
    } else walk(v);
  }
})(wf);
if (hits !== 1) { console.error("expected exactly one knowledge block, found " + hits); process.exit(2); }
if (!check) fs.writeFileSync(wfPath, JSON.stringify(wf, null, 2) + "\n");

console.log(stale.length ? (check ? "Out of date:\n  " : "Updated:\n  ") + stale.join("\n  ") : "Knowledge copies are in sync.");
process.exit(check && stale.length ? 1 : 0);
