import { build } from "esbuild";
import { cp, mkdir, writeFile } from "node:fs/promises";

await mkdir("dist/apps/daemon/src", { recursive: true });
await build({ entryPoints: ["apps/daemon/src/main.ts"], outfile: "dist/apps/daemon/src/main.js", bundle: true, platform: "node", format: "esm", target: "node24", sourcemap: true });
await build({ entryPoints: ["packages/storage/src/index.ts"], outfile: "dist/packages/storage/src/index.js", bundle: true, platform: "node", format: "esm", target: "node24" });
await cp("migrations", "dist/migrations", { recursive: true });
await cp("packages/connectors/opencode-v2", "dist/packages/connectors/opencode-v2", { recursive: true, filter: path => !path.includes("node_modules") });
await writeFile("dist/package.json", JSON.stringify({ private: true, type: "module" }) + "\n");
