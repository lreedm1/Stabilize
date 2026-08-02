const textEncoder = new TextEncoder();

const ZIP_UTF8_FLAG = 0x0800;
const PDF_PAGE_WIDTH = 612;
const PDF_PAGE_HEIGHT = 792;
const PDF_MARGIN_X = 54;
const PDF_TOP = 738;
const PDF_BOTTOM = 54;

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function stripInlineMarkdown(value) {
  return String(value || "")
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/<https?:\/\/[^>]+>/g, (match) => match.slice(1, -1))
    .replace(/<[^>]+>/g, "")
    .replace(/(\*\*|__)(.*?)\1/g, "$2")
    .replace(/(\*|_)(.*?)\1/g, "$2")
    .replace(/~~(.*?)~~/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\\([\\`*{}\[\]()#+\-.!_>])/g, "$1")
    .trim();
}

export function markdownToBlocks(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let paragraph = [];
  let codeLines = [];
  let inCode = false;

  function flushParagraph() {
    const text = stripInlineMarkdown(paragraph.join(" ").replace(/\s+/g, " "));
    if (text) blocks.push({ type: "paragraph", text });
    paragraph = [];
  }

  function flushCode() {
    if (!codeLines.length) return;
    blocks.push({ type: "code", text: codeLines.join("\n") });
    codeLines = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.replace(/\s+$/g, "");
    if (/^\s*```/.test(line)) {
      if (inCode) {
        flushCode();
        inCode = false;
      } else {
        flushParagraph();
        inCode = true;
      }
      continue;
    }

    if (inCode) {
      codeLines.push(line);
      continue;
    }

    if (!line.trim()) {
      flushParagraph();
      continue;
    }

    const heading = line.match(/^\s*(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: "heading",
        level: Math.min(3, heading[1].length),
        text: stripInlineMarkdown(heading[2]),
      });
      continue;
    }

    if (/^\s*([-*_])(?:\s*\1){2,}\s*$/.test(line)) {
      flushParagraph();
      continue;
    }

    const bullet = line.match(/^\s*[-*+]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      blocks.push({ type: "bullet", text: stripInlineMarkdown(bullet[1]) });
      continue;
    }

    const numbered = line.match(/^\s*(\d+)[.)]\s+(.+)$/);
    if (numbered) {
      flushParagraph();
      blocks.push({
        type: "numbered",
        number: Number(numbered[1]),
        text: stripInlineMarkdown(numbered[2]),
      });
      continue;
    }

    const quote = line.match(/^\s*>\s?(.*)$/);
    if (quote) {
      flushParagraph();
      blocks.push({ type: "quote", text: stripInlineMarkdown(quote[1]) });
      continue;
    }

    paragraph.push(line.trim());
  }

  flushParagraph();
  flushCode();
  return blocks;
}

function titleFromMarkdown(markdown) {
  const blocks = markdownToBlocks(markdown);
  const heading = blocks.find((block) => block.type === "heading" && block.text);
  const first = heading || blocks.find((block) => block.text);
  return String(first?.text || "Stabilize document").trim().slice(0, 80);
}

export function suggestedDocumentFilename(markdown, extension) {
  const cleanExtension = String(extension || "").replace(/^\.+/, "").toLowerCase();
  const slug = titleFromMarkdown(markdown)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54)
    .toLowerCase();
  const date = new Date().toISOString().slice(0, 10);
  return `${slug || "stabilize-document"}-${date}.${cleanExtension || "txt"}`;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concatBytes(chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.length;
  }
  return output;
}

function writeUint16(view, offset, value) {
  view.setUint16(offset, value, true);
}

function writeUint32(view, offset, value) {
  view.setUint32(offset, value >>> 0, true);
}

function createStoredZip(files) {
  const localChunks = [];
  const centralChunks = [];
  const { time, date } = dosDateTime();
  let localOffset = 0;

  for (const file of files) {
    const nameBytes = textEncoder.encode(file.name);
    const dataBytes = typeof file.content === "string"
      ? textEncoder.encode(file.content)
      : file.content;
    const checksum = crc32(dataBytes);

    const localHeader = new Uint8Array(30 + nameBytes.length);
    const localView = new DataView(localHeader.buffer);
    writeUint32(localView, 0, 0x04034b50);
    writeUint16(localView, 4, 20);
    writeUint16(localView, 6, ZIP_UTF8_FLAG);
    writeUint16(localView, 8, 0);
    writeUint16(localView, 10, time);
    writeUint16(localView, 12, date);
    writeUint32(localView, 14, checksum);
    writeUint32(localView, 18, dataBytes.length);
    writeUint32(localView, 22, dataBytes.length);
    writeUint16(localView, 26, nameBytes.length);
    writeUint16(localView, 28, 0);
    localHeader.set(nameBytes, 30);
    localChunks.push(localHeader, dataBytes);

    const centralHeader = new Uint8Array(46 + nameBytes.length);
    const centralView = new DataView(centralHeader.buffer);
    writeUint32(centralView, 0, 0x02014b50);
    writeUint16(centralView, 4, 20);
    writeUint16(centralView, 6, 20);
    writeUint16(centralView, 8, ZIP_UTF8_FLAG);
    writeUint16(centralView, 10, 0);
    writeUint16(centralView, 12, time);
    writeUint16(centralView, 14, date);
    writeUint32(centralView, 16, checksum);
    writeUint32(centralView, 20, dataBytes.length);
    writeUint32(centralView, 24, dataBytes.length);
    writeUint16(centralView, 28, nameBytes.length);
    writeUint16(centralView, 30, 0);
    writeUint16(centralView, 32, 0);
    writeUint16(centralView, 34, 0);
    writeUint16(centralView, 36, 0);
    writeUint32(centralView, 38, 0);
    writeUint32(centralView, 42, localOffset);
    centralHeader.set(nameBytes, 46);
    centralChunks.push(centralHeader);

    localOffset += localHeader.length + dataBytes.length;
  }

  const centralDirectory = concatBytes(centralChunks);
  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  writeUint32(endView, 0, 0x06054b50);
  writeUint16(endView, 4, 0);
  writeUint16(endView, 6, 0);
  writeUint16(endView, 8, files.length);
  writeUint16(endView, 10, files.length);
  writeUint32(endView, 12, centralDirectory.length);
  writeUint32(endView, 16, localOffset);
  writeUint16(endView, 20, 0);

  return concatBytes([...localChunks, centralDirectory, end]);
}

function wordRun(text, options = {}) {
  const runProperties = [];
  if (options.bold) runProperties.push("<w:b/>");
  if (options.italic) runProperties.push("<w:i/>");
  if (options.monospace) {
    runProperties.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/>');
  }
  const properties = runProperties.length ? `<w:rPr>${runProperties.join("")}</w:rPr>` : "";
  return `<w:r>${properties}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function blockToWordParagraph(block) {
  if (block.type === "heading") {
    return `<w:p><w:pPr><w:pStyle w:val="Heading${block.level}"/></w:pPr>${wordRun(block.text)}</w:p>`;
  }
  if (block.type === "bullet") {
    return `<w:p><w:pPr><w:ind w:left="540" w:hanging="270"/><w:spacing w:after="80"/></w:pPr>${wordRun(`• ${block.text}`)}</w:p>`;
  }
  if (block.type === "numbered") {
    return `<w:p><w:pPr><w:ind w:left="540" w:hanging="270"/><w:spacing w:after="80"/></w:pPr>${wordRun(`${block.number}. ${block.text}`)}</w:p>`;
  }
  if (block.type === "quote") {
    return `<w:p><w:pPr><w:ind w:left="540"/><w:spacing w:after="120"/></w:pPr>${wordRun(block.text, { italic: true })}</w:p>`;
  }
  if (block.type === "code") {
    return block.text
      .split("\n")
      .map((line) => `<w:p><w:pPr><w:ind w:left="360"/><w:spacing w:after="0"/></w:pPr>${wordRun(line || " ", { monospace: true })}</w:p>`)
      .join("");
  }
  return `<w:p><w:pPr><w:spacing w:after="160" w:line="300" w:lineRule="auto"/></w:pPr>${wordRun(block.text)}</w:p>`;
}

export function createDocxBytes(markdown, options = {}) {
  const blocks = markdownToBlocks(markdown);
  const title = String(options.title || titleFromMarkdown(markdown));
  const body = (blocks.length ? blocks : [{ type: "paragraph", text: "" }])
    .map(blockToWordParagraph)
    .join("");
  const created = new Date().toISOString();

  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1080" w:right="1080" w:bottom="1080" w:left="1080" w:header="720" w:footer="720" w:gutter="0"/></w:sectPr></w:body>
</w:document>`;

  const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Aptos" w:hAnsi="Aptos"/><w:sz w:val="22"/><w:szCs w:val="22"/></w:rPr></w:rPrDefault></w:docDefaults>
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
  <w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="34"/><w:szCs w:val="34"/><w:color w:val="173F31"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="100"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="28"/><w:szCs w:val="28"/><w:color w:val="173F31"/></w:rPr></w:style>
  <w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="80"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/><w:szCs w:val="24"/><w:color w:val="173F31"/></w:rPr></w:style>
</w:styles>`;

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

  const relationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

  const documentRelationships = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const coreProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>${escapeXml(title)}</dc:title><dc:creator>Stabilize</dc:creator><cp:lastModifiedBy>Stabilize</cp:lastModifiedBy><dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;

  const appProperties = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Stabilize</Application></Properties>`;

  return createStoredZip([
    { name: "[Content_Types].xml", content: contentTypes },
    { name: "_rels/.rels", content: relationships },
    { name: "docProps/core.xml", content: coreProperties },
    { name: "docProps/app.xml", content: appProperties },
    { name: "word/document.xml", content: documentXml },
    { name: "word/styles.xml", content: stylesXml },
    { name: "word/_rels/document.xml.rels", content: documentRelationships },
  ]);
}

function toPdfAscii(value) {
  return String(value || "")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/[–—]/g, "-")
    .replace(/…/g, "...")
    .replace(/•/g, "-")
    .replace(/[^\x20-\x7e]/g, "?");
}

function escapePdfText(value) {
  return toPdfAscii(value).replace(/([\\()])/g, "\\$1");
}

function wrapPdfText(text, fontSize, prefix = "") {
  const usableWidth = PDF_PAGE_WIDTH - PDF_MARGIN_X * 2;
  const characterWidth = Math.max(4.5, fontSize * 0.52);
  const maxCharacters = Math.max(16, Math.floor(usableWidth / characterWidth));
  const clean = toPdfAscii(text).replace(/\s+/g, " ").trim();
  const firstLimit = Math.max(8, maxCharacters - prefix.length);
  const followingPrefix = prefix ? " ".repeat(prefix.length) : "";
  const lines = [];
  let remaining = clean;
  let first = true;

  while (remaining.length) {
    const limit = first ? firstLimit : Math.max(8, maxCharacters - followingPrefix.length);
    if (remaining.length <= limit) {
      lines.push(`${first ? prefix : followingPrefix}${remaining}`);
      break;
    }
    let splitAt = remaining.lastIndexOf(" ", limit);
    if (splitAt < Math.floor(limit * 0.55)) splitAt = limit;
    lines.push(`${first ? prefix : followingPrefix}${remaining.slice(0, splitAt).trim()}`);
    remaining = remaining.slice(splitAt).trim();
    first = false;
  }

  return lines.length ? lines : [prefix];
}

function pdfLineEntries(blocks) {
  const entries = [];
  for (const block of blocks) {
    if (block.type === "heading") {
      const sizes = { 1: 18, 2: 15, 3: 13 };
      const size = sizes[block.level] || 13;
      entries.push({ spacer: block.level === 1 ? 8 : 6 });
      for (const line of wrapPdfText(block.text, size)) {
        entries.push({ text: line, size, font: "F2", leading: size * 1.35 });
      }
      entries.push({ spacer: 4 });
      continue;
    }
    if (block.type === "bullet") {
      for (const line of wrapPdfText(block.text, 11, "- ")) {
        entries.push({ text: line, size: 11, font: "F1", leading: 15 });
      }
      entries.push({ spacer: 2 });
      continue;
    }
    if (block.type === "numbered") {
      for (const line of wrapPdfText(block.text, 11, `${block.number}. `)) {
        entries.push({ text: line, size: 11, font: "F1", leading: 15 });
      }
      entries.push({ spacer: 2 });
      continue;
    }
    if (block.type === "quote") {
      for (const line of wrapPdfText(`> ${block.text}`, 11)) {
        entries.push({ text: line, size: 11, font: "F1", leading: 15, x: PDF_MARGIN_X + 18 });
      }
      entries.push({ spacer: 5 });
      continue;
    }
    if (block.type === "code") {
      for (const rawLine of block.text.split("\n")) {
        for (const line of wrapPdfText(rawLine || " ", 9)) {
          entries.push({ text: line, size: 9, font: "F1", leading: 12, x: PDF_MARGIN_X + 12 });
        }
      }
      entries.push({ spacer: 6 });
      continue;
    }
    for (const line of wrapPdfText(block.text, 11)) {
      entries.push({ text: line, size: 11, font: "F1", leading: 15 });
    }
    entries.push({ spacer: 6 });
  }
  return entries;
}

function paginatePdf(entries) {
  const pages = [[]];
  let y = PDF_TOP;
  for (const entry of entries) {
    if (entry.spacer) {
      y -= entry.spacer;
      continue;
    }
    const leading = entry.leading || 15;
    if (y - leading < PDF_BOTTOM) {
      pages.push([]);
      y = PDF_TOP;
    }
    pages.at(-1).push({ ...entry, y });
    y -= leading;
  }
  return pages.filter((page) => page.length) || [[]];
}

function buildPdf(objects) {
  let output = "%PDF-1.4\n%Stabilize\n";
  const offsets = [0];
  for (let index = 1; index < objects.length; index += 1) {
    offsets[index] = output.length;
    output += `${index} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = output.length;
  output += `xref\n0 ${objects.length}\n`;
  output += "0000000000 65535 f \n";
  for (let index = 1; index < objects.length; index += 1) {
    output += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`;
  }
  output += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return textEncoder.encode(output);
}

export function createPdfBytes(markdown) {
  const blocks = markdownToBlocks(markdown);
  const entries = pdfLineEntries(blocks.length ? blocks : [{ type: "paragraph", text: "" }]);
  const pages = paginatePdf(entries);
  const objects = [null, "", "", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>", "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"];
  const pageReferences = [];

  for (const page of pages) {
    const pageNumber = objects.length;
    const contentNumber = pageNumber + 1;
    pageReferences.push(`${pageNumber} 0 R`);
    const commands = page
      .map((line) => `BT /${line.font} ${line.size} Tf ${line.x || PDF_MARGIN_X} ${line.y.toFixed(2)} Td (${escapePdfText(line.text)}) Tj ET`)
      .join("\n");
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PDF_PAGE_WIDTH} ${PDF_PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentNumber} 0 R >>`);
    objects.push(`<< /Length ${commands.length} >>\nstream\n${commands}\nendstream`);
  }

  objects[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[2] = `<< /Type /Pages /Kids [${pageReferences.join(" ")}] /Count ${pageReferences.length} >>`;
  return buildPdf(objects);
}

function triggerDownload(bytes, type, filename) {
  if (typeof document === "undefined" || typeof URL === "undefined") {
    throw new Error("Downloads require a browser context");
  }
  const blob = new Blob([bytes], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadGeneratedDocument(markdown, format) {
  const cleanFormat = String(format || "").toLowerCase();
  if (cleanFormat === "docx") {
    triggerDownload(
      createDocxBytes(markdown),
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      suggestedDocumentFilename(markdown, "docx"),
    );
    return;
  }
  if (cleanFormat === "pdf") {
    triggerDownload(
      createPdfBytes(markdown),
      "application/pdf",
      suggestedDocumentFilename(markdown, "pdf"),
    );
    return;
  }
  throw new Error(`Unsupported document format: ${format}`);
}
