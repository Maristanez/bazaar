import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

// Invariant 4 (AGENTS.md): packages/engine and packages/gym are pure. Time, seed and data
// arrive as arguments, so the same code runs on the server and in the browser and the
// Gym is reproducible from its seed. tsconfig.pure.json already keeps I/O from typechecking;
// this catches the ambient clock and RNG, which no lib setting can remove.
const PURE_PACKAGES = ["packages/engine/src", "packages/gym/src"];
const FORBIDDEN: [RegExp, string][] = [
  [/\bDate\.now\s*\(/, "Date.now() — take `now: Date` as an argument"],
  [/\bnew\s+Date\s*\(\s*\)/, "new Date() — take `now: Date` as an argument"],
  [/\bMath\.random\s*\(/, "Math.random() — draw from the seeded rng"],
  [/\bperformance\.now\s*\(/, "performance.now() — timing belongs to the caller"],
  [/\bcrypto\.(randomUUID|getRandomValues)\s*\(/, "crypto randomness — take `newId` as an argument"],
];

const root = join(import.meta.dirname, "..");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.ts$/.test(entry.name) && !/\.test\.ts$/.test(entry.name) ? [path] : [];
  });
}

describe("pure packages", () => {
  it.each(PURE_PACKAGES)("%s reads no clock and no ambient randomness", (pkg) => {
    const violations = sourceFiles(join(root, pkg)).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .flatMap((line, i) =>
          FORBIDDEN.filter(([pattern]) => pattern.test(line)).map(
            ([, why]) => `${relative(root, file)}:${i + 1}  ${why}`,
          ),
        ),
    );
    expect(violations).toEqual([]);
  });
});
