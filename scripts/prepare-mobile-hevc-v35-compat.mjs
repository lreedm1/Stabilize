// Re-run the complete release gate after generator compatibility repairs.
import { readFile, writeFile } from "node:fs/promises";

async function replaceRequired(path, before, after, label) {
  const source = await readFile(path, "utf8");
  if (source.includes(after)) return;
  if (!source.includes(before)) {
    throw new Error(`Could not find ${label} in ${path}`);
  }
  await writeFile(path, source.replaceAll(before, after), "utf8");
}

await replaceRequired(
  "scripts/finalize-full-guest-conversation.mjs",
  String.raw`finalize-mobile-hevc-v34\\.mjs && node scripts\\/embed-favicon-fallback`,
  String.raw`finalize-mobile-hevc-v34\\.mjs && node scripts\\/finalize-mobile-hevc-v35\\.mjs && node scripts\\/embed-favicon-fallback`,
  "the pre-v35 guest pipeline tail",
);

await replaceRequired(
  "scripts/apply-human-aligned-homepage-v1.mjs",
  '    `/placeholder="${NEW_PLACEHOLDER}"/`,',
  '    `/placeholder="${NEW_PLACEHOLDER.replace("?", "\\\\?")}"/`,',
  "the unescaped homepage placeholder replacement",
);

await replaceRequired(
  "scripts/apply-human-aligned-homepage-v1.mjs",
  '  requireText(text, NEW_PLACEHOLDER, "the homepage placeholder regression");',
  '  requireText(text, `/placeholder="${NEW_PLACEHOLDER.replace("?", "\\\\?")}"/`, "the homepage placeholder regression");',
  "the unescaped homepage placeholder assertion",
);

await replaceRequired(
  "scripts/finalize-mobile-hevc-v34.mjs",
  String.raw`mobile-hevc-v34-quality-start \*\/`,
  String.raw`mobile-hevc-v(?:34|35)-quality-start \*\/`,
  "the v34 quality block start matcher",
);

await replaceRequired(
  "scripts/finalize-mobile-hevc-v34.mjs",
  String.raw`mobile-hevc-v34-quality-end \*\/`,
  String.raw`mobile-hevc-v(?:34|35)-quality-end \*\/`,
  "the v34 quality block end matcher",
);

await replaceRequired(
  "test/header-menu-copy.test.mjs",
  '/placeholder="What needs attention?"/',
  '/placeholder="What needs attention\\?"/',
  "the unescaped homepage placeholder test",
);

{
  const path = "public/_headers";
  const source = await readFile(path, "utf8");
  const pattern =
    /# mobile-hevc-v35-start[\s\S]*?# mobile-hevc-v35-end\n?/;
  const match = source.match(pattern);
  const faviconStart = "# canonical-favicon-start";

  if (match && source.indexOf(match[0]) > source.indexOf(faviconStart)) {
    const block = match[0].trim();
    const withoutBlock = source.replace(pattern, "").trimEnd();
    const faviconIndex = withoutBlock.indexOf(faviconStart);
    if (faviconIndex < 0) {
      throw new Error("Could not find the canonical favicon header block.");
    }
    const beforeFavicon = withoutBlock.slice(0, faviconIndex).trimEnd();
    const faviconAndAfter = withoutBlock.slice(faviconIndex).trimStart();
    await writeFile(
      path,
      `${beforeFavicon}\n\n${block}\n\n${faviconAndAfter}\n`,
      "utf8",
    );
  }
}

console.log("Prepared v35 pipeline, prompt generators, and header order for repeatable builds.");
