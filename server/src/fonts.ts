import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { FontBytes } from "@insuragent/shared/pdf";

const require = createRequire(import.meta.url);
const FONT_DIR = path.join(path.dirname(require.resolve("@fontsource/noto-sans-hebrew/package.json")), "files");
const font = (name: string) => fs.readFileSync(path.join(FONT_DIR, `noto-sans-hebrew-${name}-normal.woff`));

export function loadFontBytes(): FontBytes {
  return {
    hebrew400: font("hebrew-400"),
    latin400: font("latin-400"),
    hebrew700: font("hebrew-700"),
    latin700: font("latin-700"),
  };
}
