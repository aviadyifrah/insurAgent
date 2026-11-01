import { test } from "node:test";
import assert from "node:assert/strict";
import zlib from "node:zlib";
import { readXlsx, xlsxToText } from "../src/xlsx";

/** A minimal ZIP writer, enough to build test spreadsheets. */
function zip(files: Record<string, string>, deflate = true): Uint8Array {
  const locals: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const body = deflate ? zlib.deflateRawSync(data) : data;
    const nameBuf = Buffer.from(name, "utf8");
    const crc = zlib.crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0);
    dir.writeUInt16LE(20, 4);
    dir.writeUInt16LE(20, 6);
    dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt32LE(crc, 16);
    dir.writeUInt32LE(body.length, 20);
    dir.writeUInt32LE(data.length, 24);
    dir.writeUInt16LE(nameBuf.length, 28);
    dir.writeUInt32LE(offset, 42);
    locals.push(local, nameBuf, body);
    central.push(dir, nameBuf);
    offset += 30 + nameBuf.length + body.length;
  }
  const dirBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(dirBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  return new Uint8Array(Buffer.concat([...locals, dirBuf, end]));
}

const SHARED = `<?xml version="1.0"?><sst xmlns="x"><si><t>חברה</t></si><si><t>ענף</t></si><si><t>מנורה מבטחים</t></si><si><r><t>ביטוח </t></r><r><t>שיניים</t></r></si><si><t>A &amp; B</t></si></sst>`;
const SHEET = `<?xml version="1.0"?><worksheet><sheetData>
<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row>
<row r="2"><c r="A2" t="s"><v>2</v></c><c r="B2" t="s"><v>3</v></c><c r="D2"><v>1234.5</v></c></row>
<row r="3"><c r="A3" t="inlineStr"><is><t>הראל</t></is></c><c r="B3" t="s"><v>4</v></c><c r="C3"/></row>
</sheetData></worksheet>`;

test("reads shared, rich, inline and numeric cells in their columns", async () => {
  const [rows] = await readXlsx(zip({ "[Content_Types].xml": "<Types/>", "xl/sharedStrings.xml": SHARED, "xl/worksheets/sheet1.xml": SHEET }));
  assert.deepEqual(rows, [
    ["חברה", "ענף"],
    ["מנורה מבטחים", "ביטוח שיניים", "", "1234.5"],
    ["הראל", "A & B", ""],
  ]);
});

test("works with stored (uncompressed) entries and turns sheets into text", async () => {
  const text = await xlsxToText(zip({ "xl/sharedStrings.xml": SHARED, "xl/worksheets/sheet1.xml": SHEET }, false));
  assert.equal(text.split("\n")[1], "מנורה מבטחים\tביטוח שיניים\t\t1234.5");
});

test("a file that isn't a spreadsheet is rejected", async () => {
  await assert.rejects(readXlsx(new TextEncoder().encode("not a zip at all, just some text bytes")));
});
