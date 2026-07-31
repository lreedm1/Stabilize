const SAFE_LINK_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function pushText(tokens, value) {
  if (!value) return;
  const previous = tokens.at(-1);
  if (previous?.type === "text") {
    previous.value += value;
  } else {
    tokens.push({ type: "text", value });
  }
}

export function sanitizeLink(value) {
  const candidate = String(value || "").trim();
  if (!candidate || /[\u0000-\u001f\u007f]/.test(candidate)) return null;

  try {
    const parsed = new URL(candidate);
    return SAFE_LINK_PROTOCOLS.has(parsed.protocol) ? parsed.href : null;
  } catch {
    return null;
  }
}

function findLinkTargetEnd(source, start) {
  let nestedParentheses = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "(") {
      nestedParentheses += 1;
    } else if (source[index] === ")") {
      if (nestedParentheses === 0) return index;
      nestedParentheses -= 1;
    }
  }
  return -1;
}

export function tokenizeInline(value, depth = 0) {
  const source = String(value || "");
  const tokens = [];
  let cursor = 0;

  while (cursor < source.length) {
    if (source[cursor] === "\n") {
      tokens.push({ type: "break" });
      cursor += 1;
      continue;
    }

    if (source[cursor] === "`") {
      const close = source.indexOf("`", cursor + 1);
      if (close > cursor + 1) {
        tokens.push({ type: "code", value: source.slice(cursor + 1, close) });
        cursor = close + 1;
        continue;
      }
    }

    if (source.startsWith("**", cursor) && depth < 4) {
      const close = source.indexOf("**", cursor + 2);
      if (close > cursor + 2) {
        tokens.push({
          type: "strong",
          children: tokenizeInline(source.slice(cursor + 2, close), depth + 1),
        });
        cursor = close + 2;
        continue;
      }
    }

    if (source[cursor] === "*" && depth < 4) {
      const close = source.indexOf("*", cursor + 1);
      if (close > cursor + 1) {
        tokens.push({
          type: "emphasis",
          children: tokenizeInline(source.slice(cursor + 1, close), depth + 1),
        });
        cursor = close + 1;
        continue;
      }
    }

    if (source[cursor] === "[") {
      const labelEnd = source.indexOf("](", cursor + 1);
      const targetEnd =
        labelEnd < 0 ? -1 : findLinkTargetEnd(source, labelEnd + 2);
      if (labelEnd > cursor + 1 && targetEnd > labelEnd + 2) {
        const label = source.slice(cursor + 1, labelEnd);
        const href = sanitizeLink(source.slice(labelEnd + 2, targetEnd));
        if (href) {
          tokens.push({
            type: "link",
            href,
            children: tokenizeInline(label, depth + 1),
          });
        } else {
          pushText(tokens, label);
        }
        cursor = targetEnd + 1;
        continue;
      }
    }

    pushText(tokens, source[cursor]);
    cursor += 1;
  }

  return tokens;
}

function isHorizontalRule(line) {
  return /^ {0,3}(?:(?:\*\s*){3,}|(?:-\s*){3,}|(?:_\s*){3,})$/.test(line);
}

function isBlockStart(line) {
  return (
    /^ {0,3}```/.test(line) ||
    /^ {0,3}#{1,6}\s+/.test(line) ||
    /^ {0,3}>/.test(line) ||
    /^ {0,3}[-+*]\s+/.test(line) ||
    /^ {0,3}\d+[.)]\s+/.test(line) ||
    isHorizontalRule(line)
  );
}

export function parseMarkdown(value, depth = 0) {
  const lines = String(value || "").replace(/\r\n?/g, "\n").split("\n");
  const blocks = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (!line.trim()) {
      index += 1;
      continue;
    }

    const fence = line.match(/^ {0,3}```([A-Za-z0-9_-]{0,30})\s*$/);
    if (fence) {
      const code = [];
      index += 1;
      while (index < lines.length && !/^ {0,3}```\s*$/.test(lines[index])) {
        code.push(lines[index]);
        index += 1;
      }
      if (index < lines.length) index += 1;
      blocks.push({ type: "codeBlock", language: fence[1], value: code.join("\n") });
      continue;
    }

    const heading = line.match(/^ {0,3}(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        type: "heading",
        level: heading[1].length,
        children: tokenizeInline(heading[2]),
      });
      index += 1;
      continue;
    }

    if (isHorizontalRule(line)) {
      blocks.push({ type: "horizontalRule" });
      index += 1;
      continue;
    }

    if (/^ {0,3}>/.test(line)) {
      const quoteLines = [];
      while (index < lines.length) {
        const quote = lines[index].match(/^ {0,3}> ?(.*)$/);
        if (!quote) break;
        quoteLines.push(quote[1]);
        index += 1;
      }
      blocks.push({
        type: "blockquote",
        blocks:
          depth < 3
            ? parseMarkdown(quoteLines.join("\n"), depth + 1)
            : [{ type: "paragraph", children: tokenizeInline(quoteLines.join("\n")) }],
      });
      continue;
    }

    const unordered = line.match(/^ {0,3}[-+*]\s+(.+)$/);
    const ordered = line.match(/^ {0,3}\d+[.)]\s+(.+)$/);
    if (unordered || ordered) {
      const type = ordered ? "orderedList" : "unorderedList";
      const pattern = ordered
        ? /^ {0,3}\d+[.)]\s+(.+)$/
        : /^ {0,3}[-+*]\s+(.+)$/;
      const items = [];
      while (index < lines.length) {
        const item = lines[index].match(pattern);
        if (!item) break;
        items.push(tokenizeInline(item[1]));
        index += 1;
      }
      blocks.push({ type, items });
      continue;
    }

    const paragraph = [line];
    index += 1;
    while (
      index < lines.length &&
      lines[index].trim() &&
      !isBlockStart(lines[index])
    ) {
      paragraph.push(lines[index]);
      index += 1;
    }
    blocks.push({ type: "paragraph", children: tokenizeInline(paragraph.join("\n")) });
  }

  return blocks;
}

function appendInline(parent, tokens, doc) {
  for (const token of tokens) {
    if (token.type === "text") {
      parent.appendChild(doc.createTextNode(token.value));
    } else if (token.type === "break") {
      parent.appendChild(doc.createElement("br"));
    } else if (token.type === "code") {
      const code = doc.createElement("code");
      code.textContent = token.value;
      parent.appendChild(code);
    } else if (token.type === "strong" || token.type === "emphasis") {
      const element = doc.createElement(token.type === "strong" ? "strong" : "em");
      appendInline(element, token.children, doc);
      parent.appendChild(element);
    } else if (token.type === "link") {
      const link = doc.createElement("a");
      link.href = token.href;
      if (token.href.startsWith("http:") || token.href.startsWith("https:")) {
        link.target = "_blank";
        link.rel = "noopener noreferrer";
      }
      appendInline(link, token.children, doc);
      parent.appendChild(link);
    }
  }
}

function appendBlock(parent, block, doc) {
  if (block.type === "paragraph") {
    const paragraph = doc.createElement("p");
    appendInline(paragraph, block.children, doc);
    parent.appendChild(paragraph);
  } else if (block.type === "heading") {
    const heading = doc.createElement(`h${Math.min(block.level + 2, 6)}`);
    appendInline(heading, block.children, doc);
    parent.appendChild(heading);
  } else if (block.type === "orderedList" || block.type === "unorderedList") {
    const list = doc.createElement(block.type === "orderedList" ? "ol" : "ul");
    for (const item of block.items) {
      const listItem = doc.createElement("li");
      appendInline(listItem, item, doc);
      list.appendChild(listItem);
    }
    parent.appendChild(list);
  } else if (block.type === "blockquote") {
    const quote = doc.createElement("blockquote");
    for (const child of block.blocks) appendBlock(quote, child, doc);
    parent.appendChild(quote);
  } else if (block.type === "codeBlock") {
    const pre = doc.createElement("pre");
    const code = doc.createElement("code");
    if (block.language) code.className = `language-${block.language}`;
    code.textContent = block.value;
    pre.appendChild(code);
    parent.appendChild(pre);
  } else if (block.type === "horizontalRule") {
    parent.appendChild(doc.createElement("hr"));
  }
}

export function renderMarkdown(value, doc = document) {
  const fragment = doc.createDocumentFragment();
  for (const block of parseMarkdown(value)) appendBlock(fragment, block, doc);
  return fragment;
}
