import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { deflateRawSync } from "node:zlib";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const outputPath = join(rootDir, "extension", "templates", "custom-job-template.xlsx");
const crcTable = createCrcTable();

const files = [
  ["[Content_Types].xml", contentTypesXml()],
  ["_rels/.rels", rootRelationshipsXml()],
  ["docProps/core.xml", corePropertiesXml()],
  ["docProps/app.xml", appPropertiesXml()],
  ["xl/workbook.xml", workbookXml()],
  ["xl/_rels/workbook.xml.rels", workbookRelationshipsXml()],
  ["xl/styles.xml", stylesXml()],
  ["xl/worksheets/sheet1.xml", instructionsSheetXml()],
  ["xl/worksheets/sheet2.xml", stringsSheetXml()]
];

await mkdir(dirname(outputPath), {
  recursive: true
});
await writeFile(outputPath, createZip(files));

console.log(`Generated custom job template at ${relative(rootDir, outputPath)}`);

function contentTypesXml() {
  return xml(
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
      <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
      <Default Extension="xml" ContentType="application/xml"/>
      <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
      <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
      <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
      <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
      <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
      <Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
    </Types>`
  );
}

function rootRelationshipsXml() {
  return xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
    </Relationships>`
  );
}

function corePropertiesXml() {
  const createdAt = new Date().toISOString();
  return xml(
    `<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
      <dc:title>CMS Smartling Custom Job Template</dc:title>
      <dc:creator>CMS Smartling Connector</dc:creator>
      <cp:lastModifiedBy>CMS Smartling Connector</cp:lastModifiedBy>
      <dcterms:created xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:created>
      <dcterms:modified xsi:type="dcterms:W3CDTF">${createdAt}</dcterms:modified>
    </cp:coreProperties>`
  );
}

function appPropertiesXml() {
  return xml(
    `<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
      <Application>CMS Smartling Connector</Application>
    </Properties>`
  );
}

function workbookXml() {
  return xml(
    `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
      <sheets>
        <sheet name="Instructions" sheetId="1" r:id="rId1"/>
        <sheet name="Strings" sheetId="2" r:id="rId2"/>
      </sheets>
    </workbook>`
  );
}

function workbookRelationshipsXml() {
  return xml(
    `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
      <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
      <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>
      <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
    </Relationships>`
  );
}

function stylesXml() {
  return xml(
    `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      <fonts count="3">
        <font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>
        <font><b/><sz val="12"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
        <font><b/><sz val="12"/><color rgb="FF172033"/><name val="Calibri"/><family val="2"/></font>
      </fonts>
      <fills count="4">
        <fill><patternFill patternType="none"/></fill>
        <fill><patternFill patternType="gray125"/></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FF0878D7"/><bgColor indexed="64"/></patternFill></fill>
        <fill><patternFill patternType="solid"><fgColor rgb="FFEAF5FF"/><bgColor indexed="64"/></patternFill></fill>
      </fills>
      <borders count="2">
        <border><left/><right/><top/><bottom/><diagonal/></border>
        <border><left style="thin"><color rgb="FFD7E1EB"/></left><right style="thin"><color rgb="FFD7E1EB"/></right><top style="thin"><color rgb="FFD7E1EB"/></top><bottom style="thin"><color rgb="FFD7E1EB"/></bottom><diagonal/></border>
      </borders>
      <cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
      <cellXfs count="4">
        <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
        <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
        <xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="center"/></xf>
        <xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment wrapText="1" vertical="top"/></xf>
      </cellXfs>
      <cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
    </styleSheet>`
  );
}

function instructionsSheetXml() {
  const rows = [
    [cell("A1", "CMS Smartling Custom Job Template", 1)],
    [cell("A3", "How to use this file", 2)],
    [cell("A4", "1.", 3), cell("B4", "Go to the Strings sheet.", 3)],
    [
      cell("A5", "2.", 3),
      cell("B5", "Enter a short Custom label that identifies where the string belongs.", 3)
    ],
    [cell("A6", "3.", 3), cell("B6", "Enter the exact Source string to translate.", 3)],
    [cell("A7", "4.", 3), cell("B7", "Leave rows blank if they should not be submitted.", 3)],
    [
      cell("A8", "5.", 3),
      cell("B8", "Upload this workbook from the extension popup bulk import area.", 3)
    ],
    [cell("A10", "Required columns", 2)],
    [
      cell("A11", "Custom label", 3),
      cell("B11", "Human-readable label, such as Category Heading or Facet Label.", 3)
    ],
    [cell("A12", "Source string", 3), cell("B12", "The text that should be sent to Smartling.", 3)]
  ];

  return worksheetXml({
    cols: [
      [1, 1, 18],
      [2, 5, 24]
    ],
    merges: ["A1:E1", "A3:E3", "B4:E4", "B5:E5", "B6:E6", "B7:E7", "B8:E8", "A10:E10", "B11:E11", "B12:E12"],
    rows
  });
}

function stringsSheetXml() {
  const rows = [
    [cell("A1", "Custom label", 1), cell("B1", "Source string", 1), cell("C1", "Notes", 1)],
    [
      cell("A2", "Category Heading", 3),
      cell("B2", "Example category heading to translate", 3),
      cell("C2", "Replace this example row.", 3)
    ],
    [
      cell("A3", "Facet Label", 3),
      cell("B3", "Example refiner label", 3),
      cell("C3", "Replace this example row.", 3)
    ]
  ];

  for (let row = 4; row <= 50; row += 1) {
    rows.push([cell(`A${row}`, "", 3), cell(`B${row}`, "", 3), cell(`C${row}`, "", 3)]);
  }

  return worksheetXml({
    cols: [
      [1, 1, 28],
      [2, 2, 64],
      [3, 3, 34]
    ],
    freezeTopRow: true,
    rows
  });
}

function worksheetXml({ cols, freezeTopRow = false, merges = [], rows }) {
  const colXml = cols
    .map(([min, max, width]) => `<col min="${min}" max="${max}" width="${width}" customWidth="1"/>`)
    .join("");
  const sheetViewXml = freezeTopRow
    ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>`
    : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const rowXml = rows
    .map((rowCells, index) => {
      const rowNumber = getRowNumber(rowCells[0]) || index + 1;
      return `<row r="${rowNumber}">${rowCells.join("")}</row>`;
    })
    .join("");
  const mergeXml = merges.length
    ? `<mergeCells count="${merges.length}">${merges
        .map((range) => `<mergeCell ref="${range}"/>`)
        .join("")}</mergeCells>`
    : "";

  return xml(
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
      ${sheetViewXml}
      <cols>${colXml}</cols>
      <sheetData>${rowXml}</sheetData>
      ${mergeXml}
    </worksheet>`
  );
}

function cell(ref, value, styleId) {
  return `<c r="${ref}" t="inlineStr" s="${styleId}"><is><t>${escapeXml(value)}</t></is></c>`;
}

function getRowNumber(cellXml) {
  return Number.parseInt(String(cellXml).match(/ r="[A-Z]+(\d+)"/)?.[1], 10);
}

function createZip(fileEntries) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const [name, content] of fileEntries) {
    const nameBuffer = Buffer.from(name, "utf8");
    const contentBuffer = Buffer.from(content, "utf8");
    const compressed = deflateRawSync(contentBuffer);
    const crc = crc32(contentBuffer);
    const localHeader = Buffer.alloc(30);

    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt16LE(0, 10);
    localHeader.writeUInt16LE(0, 12);
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(contentBuffer.length, 22);
    localHeader.writeUInt16LE(nameBuffer.length, 26);
    localHeader.writeUInt16LE(0, 28);
    localParts.push(localHeader, nameBuffer, compressed);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(contentBuffer.length, 24);
    centralHeader.writeUInt16LE(nameBuffer.length, 28);
    centralHeader.writeUInt16LE(0, 30);
    centralHeader.writeUInt16LE(0, 32);
    centralHeader.writeUInt16LE(0, 34);
    centralHeader.writeUInt16LE(0, 36);
    centralHeader.writeUInt32LE(0, 38);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(centralHeader, nameBuffer);

    offset += localHeader.length + nameBuffer.length + compressed.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(fileEntries.length, 8);
  end.writeUInt16LE(fileEntries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ crcTable[(crc ^ byte) & 0xff];
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function createCrcTable() {
  return Array.from({ length: 256 }, (_, index) => {
    let crc = index;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    return crc >>> 0;
  });
}

function xml(value) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>${String(value)
    .replace(/>\s+</g, "><")
    .trim()}`;
}

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}
