import { inflateRawSync } from "node:zlib";

const MAX_IMPORTED_ROWS = 500;
const MAX_ZIP_ENTRIES = 256;
const MAX_SELECTED_ENTRY_COMPRESSED_BYTES = 2 * 1024 * 1024;
const MAX_SELECTED_ENTRY_UNCOMPRESSED_BYTES = 8 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED_BYTES = 16 * 1024 * 1024;
const MAX_PARSED_ROWS = 1000;
const MAX_PARSED_COLUMNS = 32;
const MAX_SHARED_STRINGS = 5000;

function parseCustomJobWorkbook(buffer) {
  const entries = readZipEntries(buffer);
  const sheetPath = getStringsSheetPath(entries);
  const sheetXml = getRequiredText(entries, sheetPath);
  const sharedStrings = getSharedStrings(entries);
  const rows = readSheetRows(sheetXml, sharedStrings);
  const header = findHeader(rows);
  const fields = [];
  let skippedRows = 0;

  for (const row of rows.filter((candidate) => candidate.index > header.rowIndex)) {
    if (fields.length >= MAX_IMPORTED_ROWS) break;

    const label = String(row.cells[header.labelColumn] || "").trim();
    const value = String(row.cells[header.sourceColumn] || "");

    if (!value.trim()) {
      if (hasAnyCellValue(row.cells)) {
        skippedRows += 1;
      }
      continue;
    }

    fields.push({
      label: label || `String ${fields.length + 1}`,
      value
    });
  }

  return {
    fields,
    importedRows: fields.length,
    skippedRows,
    sheetName: header.sheetName
  };
}

function readZipEntries(buffer) {
  if (!Buffer.isBuffer(buffer)) {
    buffer = Buffer.from(buffer);
  }

  const eocdOffset = findEndOfCentralDirectory(buffer);
  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  let centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();

  if (totalEntries > MAX_ZIP_ENTRIES) {
    throw new Error(`XLSX file has too many ZIP entries. Maximum is ${MAX_ZIP_ENTRIES}.`);
  }

  for (let index = 0; index < totalEntries; index += 1) {
    ensureBufferRange(buffer, centralDirectoryOffset, 46, "Invalid XLSX central directory.");
    if (buffer.readUInt32LE(centralDirectoryOffset) !== 0x02014b50) {
      throw new Error("Invalid XLSX central directory.");
    }

    const method = buffer.readUInt16LE(centralDirectoryOffset + 10);
    const compressedSize = buffer.readUInt32LE(centralDirectoryOffset + 20);
    const uncompressedSize = buffer.readUInt32LE(centralDirectoryOffset + 24);
    const fileNameLength = buffer.readUInt16LE(centralDirectoryOffset + 28);
    const extraLength = buffer.readUInt16LE(centralDirectoryOffset + 30);
    const commentLength = buffer.readUInt16LE(centralDirectoryOffset + 32);
    const localHeaderOffset = buffer.readUInt32LE(centralDirectoryOffset + 42);
    ensureBufferRange(
      buffer,
      centralDirectoryOffset + 46,
      fileNameLength + extraLength + commentLength,
      "Invalid XLSX central directory entry."
    );
    const fileName = buffer
      .subarray(centralDirectoryOffset + 46, centralDirectoryOffset + 46 + fileNameLength)
      .toString("utf8");

    entries.set(normalizeZipPath(fileName), {
      compressedSize,
      localHeaderOffset,
      method,
      uncompressedSize
    });

    centralDirectoryOffset += 46 + fileNameLength + extraLength + commentLength;
  }

  return {
    buffer,
    entries,
    uncompressedBytesRead: 0
  };
}

function findEndOfCentralDirectory(buffer) {
  const minOffset = Math.max(0, buffer.length - 0xffff - 22);

  for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
    if (buffer.readUInt32LE(offset) === 0x06054b50) {
      return offset;
    }
  }

  throw new Error("Invalid XLSX file. End of central directory was not found.");
}

function getEntry(zip, path) {
  const entry = zip.entries.get(normalizeZipPath(path));
  if (!entry) {
    return null;
  }

  const { buffer } = zip;
  const localOffset = entry.localHeaderOffset;
  ensureBufferRange(buffer, localOffset, 30, `Invalid XLSX local file header for ${path}.`);
  if (buffer.readUInt32LE(localOffset) !== 0x04034b50) {
    throw new Error(`Invalid XLSX local file header for ${path}.`);
  }

  if (entry.data) {
    return entry.data;
  }

  validateEntryLimits(entry, path);

  const fileNameLength = buffer.readUInt16LE(localOffset + 26);
  const extraLength = buffer.readUInt16LE(localOffset + 28);
  const dataStart = localOffset + 30 + fileNameLength + extraLength;
  ensureBufferRange(buffer, dataStart, entry.compressedSize, `Invalid XLSX compressed data for ${path}.`);
  const compressed = buffer.subarray(dataStart, dataStart + entry.compressedSize);
  let data;

  if (entry.method === 0) {
    data = compressed;
  } else if (entry.method === 8) {
    try {
      data = inflateRawSync(compressed, {
        maxOutputLength: MAX_SELECTED_ENTRY_UNCOMPRESSED_BYTES
      });
    } catch (error) {
      if (error?.code === "ERR_BUFFER_TOO_LARGE") {
        throw new Error(`XLSX entry ${path} is too large after decompression.`);
      }
      throw error;
    }
  } else {
    throw new Error(`Unsupported XLSX compression method ${entry.method}.`);
  }

  if (data.length > MAX_SELECTED_ENTRY_UNCOMPRESSED_BYTES) {
    throw new Error(`XLSX entry ${path} is too large after decompression.`);
  }

  zip.uncompressedBytesRead += data.length;
  if (zip.uncompressedBytesRead > MAX_TOTAL_UNCOMPRESSED_BYTES) {
    throw new Error("XLSX file is too large after decompression.");
  }

  entry.data = data;
  return data;
}

function validateEntryLimits(entry, path) {
  if (entry.compressedSize > MAX_SELECTED_ENTRY_COMPRESSED_BYTES) {
    throw new Error(`XLSX entry ${path} is too large.`);
  }

  if (entry.uncompressedSize > MAX_SELECTED_ENTRY_UNCOMPRESSED_BYTES) {
    throw new Error(`XLSX entry ${path} is too large after decompression.`);
  }
}

function getRequiredText(zip, path) {
  const entry = getEntry(zip, path);
  if (!entry) {
    throw new Error(`XLSX file is missing ${path}.`);
  }
  return entry.toString("utf8");
}

function getOptionalText(zip, path) {
  return getEntry(zip, path)?.toString("utf8") || "";
}

function getStringsSheetPath(zip) {
  const workbookXml = getOptionalText(zip, "xl/workbook.xml");
  const workbookRelsXml = getOptionalText(zip, "xl/_rels/workbook.xml.rels");

  if (!workbookXml || !workbookRelsXml) {
    return "xl/worksheets/sheet1.xml";
  }

  const relationships = new Map();
  for (const relMatch of workbookRelsXml.matchAll(/<Relationship\b([^>]*)\/?>/gi)) {
    const attrs = parseAttributes(relMatch[1]);
    if (attrs.Id && attrs.Target) {
      relationships.set(attrs.Id, resolveZipPath("xl", attrs.Target));
    }
  }

  const sheets = [];
  for (const sheetMatch of workbookXml.matchAll(/<sheet\b([^>]*)\/?>/gi)) {
    const attrs = parseAttributes(sheetMatch[1]);
    const relationshipId = attrs["r:id"];
    const target = relationships.get(relationshipId);
    if (target) {
      sheets.push({
        name: decodeXml(attrs.name || ""),
        path: target
      });
    }
  }

  return (
    sheets.find((sheet) => sheet.name.trim().toLowerCase() === "strings")?.path ||
    sheets[0]?.path ||
    "xl/worksheets/sheet1.xml"
  );
}

function getSharedStrings(zip) {
  const sharedStringsXml = getOptionalText(zip, "xl/sharedStrings.xml");
  if (!sharedStringsXml) {
    return [];
  }

  const sharedStrings = [];
  for (const match of sharedStringsXml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/gi)) {
    if (sharedStrings.length >= MAX_SHARED_STRINGS) {
      throw new Error(`XLSX file has too many shared strings. Maximum is ${MAX_SHARED_STRINGS}.`);
    }

    const textParts = [...match[1].matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((textMatch) =>
      decodeXml(textMatch[1])
    );

    if (textParts.length) {
      sharedStrings.push(textParts.join(""));
      continue;
    }

    sharedStrings.push(decodeXml(match[1].replace(/<[^>]+>/g, "")));
  }

  return sharedStrings;
}

function readSheetRows(sheetXml, sharedStrings) {
  const rows = [];

  for (const rowMatch of sheetXml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/gi)) {
    if (rows.length >= MAX_PARSED_ROWS) {
      throw new Error(`XLSX file has too many rows. Maximum parsed row count is ${MAX_PARSED_ROWS}.`);
    }

    const rowAttrs = parseAttributes(rowMatch[1]);
    const rowIndex = Number.parseInt(rowAttrs.r, 10) || rows.length + 1;
    const cells = [];

    for (const cellMatch of rowMatch[2].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/gi)) {
      const cellAttrs = parseAttributes(cellMatch[1]);
      const columnIndex = columnIndexFromCellRef(cellAttrs.r) ?? cells.length;
      if (columnIndex >= MAX_PARSED_COLUMNS) {
        continue;
      }
      cells[columnIndex] = readCellValue(cellAttrs, cellMatch[2], sharedStrings);
    }

    rows.push({
      cells,
      index: rowIndex
    });
  }

  return rows;
}

function readCellValue(attrs, cellXml, sharedStrings) {
  if (attrs.t === "inlineStr") {
    const textParts = [...cellXml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/gi)].map((match) =>
      decodeXml(match[1])
    );
    return textParts.join("");
  }

  const value = cellXml.match(/<v\b[^>]*>([\s\S]*?)<\/v>/i)?.[1] ?? "";

  if (attrs.t === "s") {
    return sharedStrings[Number.parseInt(value, 10)] || "";
  }

  return decodeXml(value);
}

function findHeader(rows) {
  for (const row of rows) {
    const normalizedCells = row.cells.map((value) => normalizeHeader(value));
    const labelColumn = normalizedCells.findIndex((value) =>
      ["custom label", "label", "string label", "key", "name"].includes(value)
    );
    const sourceColumn = normalizedCells.findIndex((value) =>
      ["source string", "source", "string", "text", "text to translate"].includes(value)
    );

    if (sourceColumn >= 0) {
      return {
        labelColumn: labelColumn >= 0 ? labelColumn : 0,
        rowIndex: row.index,
        sheetName: "Strings",
        sourceColumn
      };
    }
  }

  return {
    labelColumn: 0,
    rowIndex: 1,
    sheetName: "Strings",
    sourceColumn: 1
  };
}

function hasAnyCellValue(cells) {
  return cells.some((value) => String(value || "").trim());
}

function parseAttributes(source) {
  const attrs = {};
  for (const match of String(source || "").matchAll(/([\w:.-]+)="([^"]*)"/g)) {
    attrs[match[1]] = decodeXml(match[2]);
  }
  return attrs;
}

function normalizeHeader(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function decodeXml(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function columnIndexFromCellRef(cellRef) {
  const letters = String(cellRef || "").match(/^[A-Z]+/i)?.[0];
  if (!letters) {
    return null;
  }

  let index = 0;
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + letter.charCodeAt(0) - 64;
  }
  const columnIndex = index - 1;
  return columnIndex < MAX_PARSED_COLUMNS ? columnIndex : MAX_PARSED_COLUMNS;
}

function resolveZipPath(basePath, targetPath) {
  if (targetPath.startsWith("/")) {
    return normalizeZipPath(targetPath.slice(1));
  }

  const parts = `${basePath}/${targetPath}`.split("/");
  const normalized = [];
  for (const part of parts) {
    if (!part || part === ".") continue;
    if (part === "..") {
      normalized.pop();
      continue;
    }
    normalized.push(part);
  }
  return normalized.join("/");
}

function normalizeZipPath(path) {
  return String(path || "").replace(/\\/g, "/").replace(/^\/+/, "");
}

function ensureBufferRange(buffer, offset, length, message) {
  if (offset < 0 || length < 0 || offset + length > buffer.length) {
    throw new Error(message);
  }
}

export { parseCustomJobWorkbook };
