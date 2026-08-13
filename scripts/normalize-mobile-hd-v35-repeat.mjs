import { readFile, writeFile } from "node:fs/promises";

const COMMAND = "node scripts/normalize-mobile-hd-v35-repeat.mjs";
const FULL_GUEST = "node scripts/finalize-full-guest-conversation.mjs";
const POLICY_FILES = [
  "test/account-preflight.test.mjs",
  "test/signed-in-prefetch-latency.test.mjs",
];

async function update(path, transform) {
  const before = await readFile(path, "utf8");
  const after = transform(before);
  if (after !== before) await writeFile(path, after, "utf8");
}

await update("package.json", (source) => {
  const data = JSON.parse(source);
  const policy = String(data.scripts?.["apply:prompt-policy"] || "");
  if (!policy) throw new Error("package.json is missing apply:prompt-policy.");
  const commands = policy
    .split(" && ")
    .filter(Boolean)
    .filter((command) => command !== COMMAND);
  const fullGuestIndex = commands.indexOf(FULL_GUEST);
  if (fullGuestIndex < 0) {
    throw new Error("Could not locate the full guest finalizer in the policy pipeline.");
  }
  commands.splice(fullGuestIndex, 0, COMMAND);
  data.scripts["apply:prompt-policy"] = commands.join(" && ");
  return `${JSON.stringify(data, null, 2)}\n`;
});

for (const path of POLICY_FILES) {
  await update(path, (source) => {
    if (!source.includes("finalize-mobile-hd-v35")) return source;
    const lines = source.split("\n");
    const policyIndex = lines.findIndex((line) =>
      line.includes('packageJson.scripts["apply:prompt-policy"]'),
    );
    if (policyIndex < 0) {
      throw new Error(`Could not locate the policy assertion in ${path}.`);
    }
    const regexIndex = lines.findIndex(
      (line, index) =>
        index > policyIndex &&
        index <= policyIndex + 5 &&
        line.includes("finalize-mobile-hd-v35"),
    );
    if (regexIndex < 0) {
      throw new Error(`Could not locate the v35 policy regex in ${path}.`);
    }
    lines[regexIndex] = "    /finalize-full-guest-conversation\\.mjs$/,";
    return lines.join("\n");
  });
}

console.log(
  "Normalized repeated mobile HD policy assertions before the full guest finalizer.",
);
