import { readFile, writeFile } from "node:fs/promises";

const workflowPath = ".github/workflows/verify-mobile-video.yml";
const handoffPath = "public/mobile-video-handoff-v31.js";
const handoffTestPath = "test/mobile-video-handoff-v31.test.mjs";

function replaceLiteral(source, before, after, expected, label) {
  const count = source.split(before).length - 1;
  if (count !== expected) {
    throw new Error(
      `${label}: expected ${expected} occurrence(s), found ${count}`,
    );
  }
  return source.split(before).join(after);
}

let workflow = await readFile(workflowPath, "utf8");

workflow = replaceLiteral(
  workflow,
  "          version='20260813-mobile-background-v31-1'\n",
  "          background_version='20260813-mobile-background-v31-1'\n" +
    "          handoff_version='20260813-mobile-video-handoff-v31-1'\n",
  2,
  "version declarations",
);

workflow = replaceLiteral(
  workflow,
  "          style_route='/mobile-background/styles'\n",
  "          style_route='/mobile-background/styles'\n" +
    "          handoff_route='/mobile-video-handoff-v31.js'\n",
  2,
  "handoff route declarations",
);

workflow = replaceLiteral(
  workflow,
  '          grep -Fq "$video_route?v=${version}" src/page.js\n',
  '          grep -Fq "$video_route?v=${handoff_version}" src/page.js\n',
  1,
  "payload video key",
);
workflow = replaceLiteral(
  workflow,
  '          grep -Fq "$client_route?v=${version}" src/page.js\n',
  '          grep -Fq "$client_route?v=${background_version}" src/page.js\n',
  1,
  "payload runtime key",
);
workflow = replaceLiteral(
  workflow,
  '          grep -Fq "$style_route?v=${version}" src/page.js\n',
  '          grep -Fq "$style_route?v=${background_version}" src/page.js\n' +
    '          grep -Fq "$handoff_route?v=${handoff_version}" src/page.js\n',
  1,
  "payload style and handoff keys",
);
workflow = replaceLiteral(
  workflow,
  '          grep -Fq "src=\\"${video_route}?v=${version}\\"" src/page.js\n',
  '          grep -Fq "src=\\"${video_route}?v=${handoff_version}\\"" src/page.js\n',
  1,
  "payload parser-visible video source",
);

workflow = replaceLiteral(
  workflow,
  "          grep -Fq -- '--mobile-background-v30-fade: 180ms' public/mobile-background-v30.css\n",
  "          grep -Fq -- '--mobile-background-v30-fade: 180ms' public/mobile-background-v30.css\n" +
    "          grep -Fq 'const VERSION = \\\"20260813-mobile-video-handoff-v31-1\\\"' public/mobile-video-handoff-v31.js\n" +
    "          grep -Fq 'const result = video.play();' public/mobile-video-handoff-v31.js\n" +
    "          grep -Fq 'playInsideUserGesture' public/mobile-video-handoff-v31.js\n",
  1,
  "payload handoff controller checks",
);

workflow = replaceLiteral(
  workflow,
  '            client_status="$(curl --max-time 25 --silent --show-error --compressed -H \'Cache-Control: no-cache\' -D "$tmpdir/client.headers" -o "$tmpdir/client.js" -w \'%{http_code}\' "https://stabilize.info${client_route}?v=${version}&release=${key}" || true)"\n',
  '            client_status="$(curl --max-time 25 --silent --show-error --compressed -H \'Cache-Control: no-cache\' -D "$tmpdir/client.headers" -o "$tmpdir/client.js" -w \'%{http_code}\' "https://stabilize.info${client_route}?v=${background_version}&release=${key}" || true)"\n',
  1,
  "production runtime URL",
);
workflow = replaceLiteral(
  workflow,
  '            style_status="$(curl --max-time 25 --silent --show-error --compressed -H \'Cache-Control: no-cache\' -D "$tmpdir/style.headers" -o "$tmpdir/styles.css" -w \'%{http_code}\' "https://stabilize.info${style_route}?v=${version}&release=${key}" || true)"\n',
  '            style_status="$(curl --max-time 25 --silent --show-error --compressed -H \'Cache-Control: no-cache\' -D "$tmpdir/style.headers" -o "$tmpdir/styles.css" -w \'%{http_code}\' "https://stabilize.info${style_route}?v=${background_version}&release=${key}" || true)"\n' +
    '            handoff_status="$(curl --max-time 25 --silent --show-error --compressed -H \'Cache-Control: no-cache\' -D "$tmpdir/handoff.headers" -o "$tmpdir/handoff.js" -w \'%{http_code}\' "https://stabilize.info${handoff_route}?v=${handoff_version}&release=${key}" || true)"\n',
  1,
  "production style and handoff URLs",
);
workflow = replaceLiteral(
  workflow,
  '            poster_status="$(curl --max-time 40 --silent --show-error -H \'Cache-Control: no-cache\' -o "$tmpdir/poster.webp" -w \'%{http_code}\' "https://stabilize.info${poster_route}?v=${version}&release=${key}" || true)"\n',
  '            poster_status="$(curl --max-time 40 --silent --show-error -H \'Cache-Control: no-cache\' -o "$tmpdir/poster.webp" -w \'%{http_code}\' "https://stabilize.info${poster_route}?v=${background_version}&release=${key}" || true)"\n',
  1,
  "production poster URL",
);
workflow = replaceLiteral(
  workflow,
  '            atlas_status="$(curl --max-time 40 --silent --show-error -H \'Cache-Control: no-cache\' -o "$tmpdir/atlas.webp" -w \'%{http_code}\' "https://stabilize.info${atlas_route}?v=${version}&release=${key}" || true)"\n',
  '            atlas_status="$(curl --max-time 40 --silent --show-error -H \'Cache-Control: no-cache\' -o "$tmpdir/atlas.webp" -w \'%{http_code}\' "https://stabilize.info${atlas_route}?v=${background_version}&release=${key}" || true)"\n',
  1,
  "production atlas URL",
);

workflow = replaceLiteral(
  workflow,
  '            style_type="$(header_value "$tmpdir/style.headers" content-type | tr \'[:upper:]\' \'[:lower:]\')"\n',
  '            style_type="$(header_value "$tmpdir/style.headers" content-type | tr \'[:upper:]\' \'[:lower:]\')"\n' +
    '            handoff_type="$(header_value "$tmpdir/handoff.headers" content-type | tr \'[:upper:]\' \'[:lower:]\')"\n',
  1,
  "production handoff content type",
);
workflow = replaceLiteral(
  workflow,
  '            echo "v31 attempt ${attempt}: page=${page_status:-000} client=${client_status:-000} style=${style_status:-000} poster=${poster_status:-000} atlas=${atlas_status:-000}"\n',
  '            echo "v31 attempt ${attempt}: page=${page_status:-000} client=${client_status:-000} style=${style_status:-000} handoff=${handoff_status:-000} poster=${poster_status:-000} atlas=${atlas_status:-000}"\n',
  1,
  "production attempt diagnostics",
);
workflow = replaceLiteral(
  workflow,
  '              && "$style_status" == 200 \\\n',
  '              && "$style_status" == 200 \\\n' +
    '              && "$handoff_status" == 200 \\\n',
  1,
  "production handoff status gate",
);
workflow = replaceLiteral(
  workflow,
  '              && "$style_type" == text/css* \\\n',
  '              && "$style_type" == text/css* \\\n' +
    '              && "$handoff_type" == text/javascript* \\\n',
  1,
  "production handoff type gate",
);
workflow = replaceLiteral(
  workflow,
  '              && grep -Fq "$video_route?v=${version}" "$tmpdir/page.html" \\\n',
  '              && grep -Fq "$video_route?v=${handoff_version}" "$tmpdir/page.html" \\\n',
  1,
  "production page video key",
);
workflow = replaceLiteral(
  workflow,
  '              && grep -Fq "$client_route?v=${version}" "$tmpdir/page.html" \\\n',
  '              && grep -Fq "$client_route?v=${background_version}" "$tmpdir/page.html" \\\n',
  1,
  "production page runtime key",
);
workflow = replaceLiteral(
  workflow,
  '              && grep -Fq "$style_route?v=${version}" "$tmpdir/page.html" \\\n',
  '              && grep -Fq "$style_route?v=${background_version}" "$tmpdir/page.html" \\\n' +
    '              && grep -Fq "$handoff_route?v=${handoff_version}" "$tmpdir/page.html" \\\n',
  1,
  "production page style and handoff keys",
);
workflow = replaceLiteral(
  workflow,
  "              && grep -Fq 'result = video.play()' \"$tmpdir/client.js\" \\\n",
  "              && grep -Fq 'result = video.play()' \"$tmpdir/client.js\" \\\n" +
    "              && grep -Fq 'playInsideUserGesture' \"$tmpdir/handoff.js\" \\\n" +
    "              && grep -Fq '20260813-mobile-video-handoff-v31-1' \"$tmpdir/handoff.js\" \\\n",
  1,
  "production live handoff checks",
);
workflow = replaceLiteral(
  workflow,
  '"https://stabilize.info${video_route}?v=${version}&release=${key}"',
  '"https://stabilize.info${video_route}?v=${handoff_version}&release=${key}"',
  1,
  "production full video URL",
);
workflow = replaceLiteral(
  workflow,
  '"https://stabilize.info${video_route}?v=${version}&range=${key}"',
  '"https://stabilize.info${video_route}?v=${handoff_version}&range=${key}"',
  1,
  "production range video URL",
);

if (workflow.includes("${version}")) {
  throw new Error("A stale generic ${version} reference remains in the verifier.");
}
if (
  workflow.split("handoff_version='20260813-mobile-video-handoff-v31-1'").length -
    1 !==
  2
) {
  throw new Error("Expected handoff_version in payload and production jobs.");
}
if (
  workflow.split("handoff_route='/mobile-video-handoff-v31.js'").length - 1 !==
  2
) {
  throw new Error("Expected handoff_route in payload and production jobs.");
}

await writeFile(workflowPath, workflow, "utf8");

let handoff = await readFile(handoffPath, "utf8");
handoff = replaceLiteral(
  handoff,
  'root.dataset.mobileBackgroundV30Quality = "native-2160x3840-24fps";',
  'root.dataset.mobileBackgroundV30Quality = "native-video-2160x3840-24fps";',
  1,
  "canonical native-video quality state",
);
await writeFile(handoffPath, handoff, "utf8");

let handoffTest = await readFile(handoffTestPath, "utf8");
handoffTest = replaceLiteral(
  handoffTest,
  "  assert.match(client, /requestVideoFrameCallback/);\n",
  "  assert.match(client, /requestVideoFrameCallback/);\n" +
    "  assert.match(client, /native-video-2160x3840-24fps/);\n",
  1,
  "handoff quality-state regression",
);
await writeFile(handoffTestPath, handoffTest, "utf8");

console.log(
  "Corrected the v31 background/handoff cache-key gate and native-video quality state.",
);
