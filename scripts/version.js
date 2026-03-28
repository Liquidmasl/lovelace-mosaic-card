/**
 * Stamps the version from package.json into the built JS file.
 * Run after build: node scripts/version.js
 *
 * Usage in CI:
 *   npm run build
 *   npm run version
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");

const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf-8"));
const version = pkg.version;

const outFile = resolve(root, "mosaic-card.js");
let content = readFileSync(outFile, "utf-8");
content = content.replaceAll("__VERSION__", version);
writeFileSync(outFile, content, "utf-8");

console.log(`Stamped version ${version} into mosaic-card.js`);
