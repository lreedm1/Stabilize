import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("follow-up actions stay contextual without duplicating signed-in history", async () => {
  const [clientScript, pageSource] = await Promise.all([
    readFile(new URL("../public/app.js", import.meta.url), "utf8"),
    readFile(new URL("../src/page.js", import.meta.url), "utf8"),
  ]);

  assert.match(clientScript, /ROUTE_ACTION_SETS/);
  assert.match(clientScript, /FLOOR_FOOD/);
  assert.match(clientScript, /FLOOR_REST/);
  assert.match(clientScript, /LOW_SLEEP_URGENCY/);
  assert.match(clientScript, /CONTENT_ACTION_SETS/);
  assert.match(clientScript, /What should we do with the message\?/);
  assert.match(clientScript, /What would make the choice clearer\?/);
  assert.match(clientScript, /What would move this forward\?/);
  assert.match(clientScript, /What would protect the essentials\?/);
  assert.match(clientScript, /What would make connection easier\?/);
  assert.match(
    clientScript,
    /void sendMessage\(buildOutcomeActionPrompt\(prompt, previousReply\)\)/,
  );
  assert.match(
    clientScript,
    /if \(continuityState\.mode === "account"\) return request;/,
  );
  assert.match(clientScript, /Use this previous answer as context/);
  assert.match(clientScript, /selectOutcomeActionSet\(route, previousReply\)/);
  assert.match(clientScript, /route: record\.route/);
  assert.match(pageSource, /app\.js\?v=[^"\s]+/);
});
