import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createBazaarServer } from "./application.js";

loadLocalEnv();
const server = await createBazaarServer();
const port = Number(process.env.PORT || 3000);
server.listen(port, () => console.log(`Bazaar server listening on :${port}`));

function loadLocalEnv() {
  const startDir = dirname(fileURLToPath(import.meta.url));
  const candidates = [join(startDir, "../../../.env"), join(startDir, "../../.env"), join(process.cwd(), ".env")];
  for (const candidate of candidates) {
    try {
      const envText = readFileSync(resolve(candidate), "utf8");
      for (const line of envText.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
        const index = trimmed.indexOf("=");
        const key = trimmed.slice(0, index).trim();
        const rawValue = trimmed.slice(index + 1).trim();
        const value = rawValue.replace(/^["']|["']$/g, "");
        if (key && process.env[key] === undefined) process.env[key] = value;
      }
      return;
    } catch {
      // Try the next likely repo/app location.
    }
  }
}
