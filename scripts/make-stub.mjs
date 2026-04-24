// Copies caxa's Windows stub and embeds icon.ico into the copy.
// caxa then uses the icon-embedded stub as its launcher.
import { copyFileSync } from "fs";
import { rcedit } from "rcedit";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const src  = path.join(ROOT, "node_modules/caxa/stubs/stub--win32--x64");
const dest = path.join(ROOT, "icon-stub.exe");

copyFileSync(src, dest);
await rcedit(dest, { icon: path.join(ROOT, "icon.ico") });
console.log("✓ icon-stub.exe ready");
