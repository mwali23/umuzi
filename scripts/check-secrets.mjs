import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const skip = new Set([
  "node_modules",
  ".git",
  "dist",
  ".vercel",
  "test-results",
  "playwright-report",
]);
const checks = [
  /sb_secret_[A-Za-z0-9_-]{10,}/g,
  /(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/g,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g,
  /postgres(?:ql)?:\/\/[^\s:@]+:[^\s@]+@/g,
  /eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}/g,
  /sk_live_[A-Za-z0-9]{12,}/g,
];
let failures = 0;
async function scan(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (skip.has(entry.name)) continue;
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      await scan(file);
      continue;
    }
    // Local environment files are intentionally untracked. Check gitignore before push too.
    if (entry.name.startsWith(".env") && entry.name !== ".env.example")
      continue;
    const data = await readFile(file, "utf8");
    for (const check of checks) {
      check.lastIndex = 0;
      if (check.test(data)) {
        console.error(`Potential credential in ${file}. Value redacted.`);
        failures++;
        break;
      }
    }
  }
}
await scan(process.cwd());
if (failures) process.exitCode = 1;
else
  console.log(
    "No credential patterns found in source. This is a guardrail, not a complete secret audit.",
  );
