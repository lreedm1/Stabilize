import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  createDocxBytes,
  createPdfBytes,
  markdownToBlocks,
  suggestedDocumentFilename,
} from "../public/document-export.js";

const sample = `# A practical plan

This is a **clear** paragraph with a [source](https://example.com).

- Eat something simple
- Drink water

1. Start now
2. Review later`;

test("markdown is converted into document blocks", () => {
  const blocks = markdownToBlocks(sample);
  assert.deepEqual(blocks.slice(0, 4), [
    { type: "heading", level: 1, text: "A practical plan" },
    {
      type: "paragraph",
      text: "This is a clear paragraph with a source (https://example.com).",
    },
    { type: "bullet", text: "Eat something simple" },
    { type: "bullet", text: "Drink water" },
  ]);
});

test("Word export creates an Office Open XML package", () => {
  const bytes = createDocxBytes(sample);
  assert.ok(bytes instanceof Uint8Array);
  assert.equal(String.fromCharCode(...bytes.slice(0, 2)), "PK");
  const visible = new TextDecoder().decode(bytes);
  assert.match(visible, /word\/document\.xml/);
  assert.match(visible, /A practical plan/);
  assert.match(visible, /Eat something simple/);
  assert.ok(bytes.length > 4000);
});

test("PDF export creates a paginated PDF document", () => {
  const bytes = createPdfBytes(sample.repeat(25));
  assert.ok(bytes instanceof Uint8Array);
  const visible = new TextDecoder().decode(bytes);
  assert.match(visible, /^%PDF-1\.4/);
  assert.match(visible, /\/Type \/Pages/);
  assert.match(visible, /\/Count [2-9]/);
  assert.match(visible, /\(A practical plan\)/);
  assert.match(visible, /%%EOF\n$/);
});

test("filenames are safe and format-specific", () => {
  assert.match(
    suggestedDocumentFilename(sample, "docx"),
    /^a-practical-plan-\d{4}-\d{2}-\d{2}\.docx$/,
  );
  assert.match(
    suggestedDocumentFilename(sample, ".pdf"),
    /^a-practical-plan-\d{4}-\d{2}-\d{2}\.pdf$/,
  );
});

test("successful responses expose local Word and PDF actions", async () => {
  const [pageSource, uiSource, styles] = await Promise.all([
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
    readFile(new URL("../public/document-export-ui.js", import.meta.url), "utf8"),
    readFile(new URL("../public/document-export.css", import.meta.url), "utf8"),
  ]);

  assert.match(pageSource, /document-export\.css/);
  assert.match(pageSource, /document-export-ui\.js/);
  assert.match(uiSource, /Word \(\.docx\)/);
  assert.match(uiSource, /format: "pdf"/);
  assert.match(uiSource, /thinking-output/);
  assert.match(uiSource, /error-output/);
  assert.match(styles, /\.document-export-button/);
});
