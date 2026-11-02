import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

async function check(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (![".git", "node_modules", "dist", "coverage", ".plotline"].includes(entry.name)) await check(join(dir, entry.name));
    } else if (entry.isFile() && /\.jsonc?$/i.test(entry.name)) {
      const path = join(dir, entry.name);
      const bytes = await readFile(path);
      if (bytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) throw new Error(`UTF-8 BOM: ${path}`);
    }
  }
}
await check(process.cwd());
