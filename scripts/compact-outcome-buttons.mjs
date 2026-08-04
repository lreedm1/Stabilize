import { readFile, writeFile } from "node:fs/promises";

const path = "public/product.css";
const marker = "/* compact horizontal outcome buttons */";
const source = await readFile(path, "utf8");

const compactStyles = `

${marker}
.outcome-tray {
  width: min(760px, 100%);
  margin: 0 auto 7px;
  overflow-x: auto;
  scrollbar-width: none;
}

.outcome-tray::-webkit-scrollbar {
  display: none;
}

.outcome-check {
  border: 0;
  border-radius: 0;
  background: transparent;
  box-shadow: none;
  padding: 0;
  backdrop-filter: none;
}

.outcome-question {
  display: none;
}

.outcome-actions,
@media (max-width: 620px) {
  .outcome-actions {
    display: flex;
    flex-wrap: nowrap;
    justify-content: flex-start;
    gap: 6px;
    margin: 0;
    width: max-content;
    min-width: 100%;
  }

  .outcome-button {
    width: auto;
    min-height: 30px;
    flex: 0 0 auto;
    border-radius: 999px;
    padding: 5px 10px;
    font-size: 0.69rem;
    line-height: 1.1;
    white-space: nowrap;
  }
}
`;

let next = source;
const start = next.indexOf(marker);
if (start >= 0) next = next.slice(0, Math.max(0, start - 2)).trimEnd() + "\n";
next += compactStyles;
await writeFile(path, next);
console.log("Compacted follow-up prompts into a horizontal button row.");
