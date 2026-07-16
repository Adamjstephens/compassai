import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { sanitizeScorecardLibrary } from "../lib/qa-safety.ts";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspace = path.resolve(scriptDir, "../../..");
const ignored = new Set([".git", "node_modules", "_old_stale_artifacts_DO_NOT_SEND"]);
const targets = [];

function visit(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) visit(target);
    else if (entry.name === "qa_scorecards.json" || entry.name === "qa_scorecards_library.json") targets.push(target);
  }
}

visit(workspace);
let changed = 0;
for (const target of targets) {
  const original = JSON.parse(fs.readFileSync(target, "utf8"));
  const cleaned = sanitizeScorecardLibrary(original);
  const next = `${JSON.stringify(cleaned, null, 2)}\n`;
  if (next !== fs.readFileSync(target, "utf8")) {
    fs.writeFileSync(target, next);
    changed += 1;
    console.log(`Cleaned ${path.relative(workspace, target)}`);
  }
}
console.log(`Checked ${targets.length} scorecard libraries; updated ${changed}.`);
