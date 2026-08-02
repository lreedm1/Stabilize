import { downloadGeneratedDocument } from "./document-export.js";

const chatLog = document.querySelector("#chat-log");

function inlineMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (!(node instanceof Element)) return "";

  const content = Array.from(node.childNodes).map(inlineMarkdown).join("");
  const tag = node.tagName.toLowerCase();
  if (tag === "br") return "\n";
  if (tag === "strong" || tag === "b") return `**${content}**`;
  if (tag === "em" || tag === "i") return `*${content}*`;
  if (tag === "code") return `\`${content}\``;
  if (tag === "a") {
    const href = node.getAttribute("href");
    return href ? `[${content}](${href})` : content;
  }
  return content;
}

function blockMarkdown(node) {
  if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
  if (!(node instanceof Element)) return "";

  const tag = node.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    const renderedLevel = Number(tag.slice(1));
    const markdownLevel = Math.max(1, Math.min(6, renderedLevel - 2));
    return `${"#".repeat(markdownLevel)} ${inlineMarkdown(node).trim()}\n\n`;
  }
  if (tag === "p") return `${inlineMarkdown(node).trim()}\n\n`;
  if (tag === "ul") {
    return `${Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child) => `- ${inlineMarkdown(child).trim()}`)
      .join("\n")}\n\n`;
  }
  if (tag === "ol") {
    return `${Array.from(node.children)
      .filter((child) => child.tagName.toLowerCase() === "li")
      .map((child, index) => `${index + 1}. ${inlineMarkdown(child).trim()}`)
      .join("\n")}\n\n`;
  }
  if (tag === "blockquote") {
    const quoted = Array.from(node.childNodes).map(blockMarkdown).join("").trim();
    return `${quoted.split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
  }
  if (tag === "pre") {
    return `\`\`\`\n${node.textContent || ""}\n\`\`\`\n\n`;
  }
  if (tag === "hr") return "---\n\n";
  return Array.from(node.childNodes).map(blockMarkdown).join("");
}

function responseMarkdown(article) {
  const clone = article.cloneNode(true);
  clone.querySelectorAll(".outcome-check, .document-export").forEach((node) => node.remove());
  return Array.from(clone.childNodes)
    .map(blockMarkdown)
    .join("")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function attachDocumentExport(article) {
  if (!(article instanceof HTMLElement)) return;
  if (!article.classList.contains("assistant-output")) return;
  if (article.classList.contains("thinking-output") || article.classList.contains("error-output")) return;
  if (article.querySelector(":scope > .document-export")) return;

  const source = responseMarkdown(article);
  if (!source) return;

  const section = document.createElement("section");
  section.className = "document-export";
  section.setAttribute("aria-label", "Export this response as a document");

  const label = document.createElement("p");
  label.className = "document-export-label";
  label.textContent = "Export this response";

  const actions = document.createElement("div");
  actions.className = "document-export-actions";

  const status = document.createElement("span");
  status.className = "document-export-status";
  status.setAttribute("aria-live", "polite");

  const buttons = [
    { format: "docx", label: "Word (.docx)" },
    { format: "pdf", label: "PDF" },
  ].map(({ format, label: buttonLabel }) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "document-export-button";
    button.textContent = buttonLabel;
    button.addEventListener("click", () => {
      for (const peer of buttons) peer.disabled = true;
      const original = button.textContent;
      button.textContent = "Creating…";
      status.textContent = "";
      try {
        downloadGeneratedDocument(source, format);
        status.textContent = `${buttonLabel} ready.`;
      } catch (error) {
        console.error("Document export failed", error);
        status.textContent = "Could not create the document. Try again.";
      } finally {
        button.textContent = original;
        for (const peer of buttons) peer.disabled = false;
      }
    });
    actions.appendChild(button);
    return button;
  });

  section.append(label, actions, status);
  const outcomeCheck = article.querySelector(":scope > .outcome-check");
  if (outcomeCheck) article.insertBefore(section, outcomeCheck);
  else article.appendChild(section);
}

function scanForResponses(root = chatLog) {
  if (!(root instanceof Element)) return;
  if (root.matches("article.assistant-output")) attachDocumentExport(root);
  root.querySelectorAll("article.assistant-output").forEach(attachDocumentExport);
}

if (chatLog instanceof HTMLElement) {
  scanForResponses();
  const observer = new MutationObserver((records) => {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node instanceof Element) scanForResponses(node);
      }
    }
  });
  observer.observe(chatLog, { childList: true, subtree: true });
}
