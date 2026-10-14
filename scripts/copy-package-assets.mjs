/**
 * Copies release assets into the ng-packagr output directory.
 *
 * ng-packagr ships README.md and LICENSE automatically; CHANGELOG.md is
 * copied here so the published package carries its release notes.
 */
import { copyFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

copyFileSync(
  resolve(root, "projects/libraries/coroutines/CHANGELOG.md"),
  resolve(root, "dist/coroutines/CHANGELOG.md"),
);
