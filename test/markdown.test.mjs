import test from "node:test";
import assert from "node:assert/strict";
import {
  parseMarkdown,
  renderMarkdown,
  sanitizeLink,
  tokenizeInline,
} from "../public/markdown.js";

class TestNode {
  constructor(tagName, value = "") {
    this.tagName = tagName;
    this.value = value;
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }

  set textContent(value) {
    this.children = [new TestNode("#text", String(value))];
  }

  get textContent() {
    if (this.tagName === "#text") return this.value;
    return this.children.map((child) => child.textContent).join("");
  }
}

const testDocument = {
  createDocumentFragment: () => new TestNode("#fragment"),
  createElement: (tagName) => new TestNode(tagName),
  createTextNode: (value) => new TestNode("#text", String(value)),
};

test("parses common Markdown blocks without interpreting raw HTML", () => {
  const blocks = parseMarkdown(`# Heading

- **Eat** something
- Rest

> One small step

\`\`\`js
const value = "<script>";
\`\`\`

<img src=x onerror=alert(1)>`);

  assert.deepEqual(
    blocks.map((block) => block.type),
    ["heading", "unorderedList", "blockquote", "codeBlock", "paragraph"],
  );
  assert.equal(blocks[1].items[0][0].type, "strong");
  assert.equal(blocks[3].value, 'const value = "<script>";');
  assert.equal(blocks[4].children[0].type, "text");
  assert.match(blocks[4].children[0].value, /<img/);
});

test("allows useful links and rejects executable or data URLs", () => {
  assert.equal(sanitizeLink("https://example.com/help"), "https://example.com/help");
  assert.equal(sanitizeLink("tel:988"), "tel:988");
  assert.equal(sanitizeLink("javascript:alert(1)"), null);
  assert.equal(sanitizeLink("data:text/html,<script>alert(1)</script>"), null);

  const unsafe = tokenizeInline("[click me](javascript:alert(1))");
  assert.deepEqual(unsafe, [{ type: "text", value: "click me" }]);

  const safe = tokenizeInline("[Open help](https://example.com/help)");
  assert.equal(safe[0].type, "link");
  assert.equal(safe[0].href, "https://example.com/help");
});

test("renders allowlisted elements with text nodes instead of raw HTML", () => {
  const fragment = renderMarkdown(
    "**Start here.** [Open help](https://example.com/help)\n\n<script>alert(1)</script>",
    testDocument,
  );

  assert.deepEqual(
    fragment.children.map((child) => child.tagName),
    ["p", "p"],
  );
  assert.equal(fragment.children[0].children[0].tagName, "strong");
  const link = fragment.children[0].children[2];
  assert.equal(link.tagName, "a");
  assert.equal(link.href, "https://example.com/help");
  assert.equal(link.target, "_blank");
  assert.equal(link.rel, "noopener noreferrer");
  assert.equal(fragment.children[1].textContent, "<script>alert(1)</script>");
});
