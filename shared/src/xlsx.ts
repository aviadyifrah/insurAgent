/**
 * Reads the cells of an .xlsx file (a ZIP of XML parts) into rows of text, with no library: the
 * browser's DecompressionStream unzips and the XML is simple enough for regular expressions.
 * Enough for exported reports such as the Har HaBituach policy list; not a general spreadsheet reader.
 */

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new Blob([data as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** The ZIP entries whose names match, decompressed, keyed by name. */
async function unzip(bytes: Uint8Array, wanted: (name: string) => boolean): Promise<Map<string, string>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = view.getUint16(eocd + 10, true);
  let p = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const out = new Map<string, string>();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(p, true) !== 0x02014b50) throw new Error("bad zip directory");
    const method = view.getUint16(p + 10, true);
    const size = view.getUint32(p + 20, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const local = view.getUint32(p + 42, true);
    const name = decoder.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (!wanted(name)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const raw = bytes.subarray(start, start + size);
    if (method !== 0 && method !== 8) throw new Error(`unsupported zip compression ${method}`);
    out.set(name, decoder.decode(method === 8 ? await inflateRaw(raw) : raw));
  }
  return out;
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const unescapeXml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
    e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (ENTITIES[e] ?? m),
  );

/** All the text runs inside an element (rich text splits a string into several <t>). */
const textOf = (xml: string) => [...xml.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map((m) => unescapeXml(m[1])).join("");

const columnIndex = (ref: string) => [...ref.replace(/\d+/g, "")].reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1;

/** Every sheet's rows, as arrays of cell text. */
export async function readXlsx(bytes: Uint8Array): Promise<string[][][]> {
  const parts = await unzip(bytes, (n) => n === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/.test(n));
  const shared = [...(parts.get("xl/sharedStrings.xml") ?? "").matchAll(/<(?:\w+:)?si>([\s\S]*?)<\/(?:\w+:)?si>/g)].map((m) => textOf(m[1]));
  const sheetNames = [...parts.keys()].filter((n) => n.startsWith("xl/worksheets/")).sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
  return sheetNames.map((name) =>
    [...parts.get(name)!.matchAll(/<(?:\w+:)?row\b[^>]*>([\s\S]*?)<\/(?:\w+:)?row>/g)].map((row) => {
      const cells: string[] = [];
      for (const c of row[1].matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
        const attrs = c[1];
        const inner = c[2] ?? "";
        const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
        const type = attrs.match(/\bt="(\w+)"/)?.[1];
        const v = inner.match(/<(?:\w+:)?v>([\s\S]*?)<\/(?:\w+:)?v>/)?.[1];
        const text = type === "s" ? (shared[Number(v)] ?? "") : type === "inlineStr" ? textOf(inner) : unescapeXml(v ?? "");
        cells[ref ? columnIndex(ref) : cells.length] = text;
      }
      return Array.from(cells, (x) => x ?? "");
    }),
  );
}

/** The sheets as tab-separated text, for reading by a model. Empty rows are dropped. */
export async function xlsxToText(bytes: Uint8Array): Promise<string> {
  const sheets = await readXlsx(bytes);
  return sheets
    .map((rows) => rows.filter((r) => r.some((c) => c.trim())).map((r) => r.join("\t")).join("\n"))
    .filter(Boolean)
    .join("\n\n");
}
