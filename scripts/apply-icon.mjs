import { rcedit } from "rcedit";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
// Target defaults to hermes.exe; can pass a different path as argv[2]
const target = process.argv[2] ?? path.join(ROOT, "hermes.exe");
await rcedit(target, { icon: path.join(ROOT, "icon.ico") });
console.log(`✓ Icon applied to ${path.basename(target)}`);
