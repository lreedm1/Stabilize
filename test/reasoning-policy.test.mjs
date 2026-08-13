import test from "node:test";
import assert from "node:assert/strict";
import { selectReasoningEffort } from "../src/reasoning-policy.js";

const effort = (latestText, options = {}) =>
  selectReasoningEffort({ latestText, ...options });

test("uses low effort for greetings and bounded execution help", () => {
  assert.equal(effort("Hello!"), "low");
  assert.equal(effort("Help me plan one next step."), "low");
  assert.equal(effort("I have three things due and can't start."), "low");
});

test("uses low effort for ordinary drafting, food, and scheduling", () => {
  assert.equal(effort("Draft a short email asking to reschedule."), "low");
  assert.equal(effort("Make a salmon dinner recipe."), "low");
  assert.equal(effort("Help me schedule a dentist appointment."), "low");
});

test("uses medium effort for ordinary questions and consequential drafting", () => {
  assert.equal(effort("How does compound interest work?"), "medium");
  assert.equal(effort("Draft a lease termination notice."), "medium");
});

test("keeps Floor turns low and low-sleep urgency bounded at medium", () => {
  assert.equal(
    effort("I have not eaten today.", { route: "FLOOR_FOOD" }),
    "low",
  );
  assert.equal(
    effort("I have not slept and want to quit my job.", {
      route: "LOW_SLEEP_URGENCY",
    }),
    "medium",
  );
});

test("targets max effort for consequential multi-factor decisions", () => {
  assert.equal(
    effort(
      "I am deciding whether to accept a job in Madison or Milwaukee. Compare pay, housing costs, commute, career growth, and stability.",
    ),
    "max",
  );
  assert.equal(
    effort(
      "Compare these two platform architectures for cost, security, maintenance, performance, and scalability.",
    ),
    "max",
  );
});

test("uses recent conversation context for short decision follow-ups", () => {
  assert.equal(
    effort("Which one is safer?", {
      messages: [
        {
          role: "user",
          content:
            "I am choosing between two apartments and need to weigh rent, commute, neighborhood safety, and lease flexibility.",
        },
      ],
    }),
    "max",
  );
});

test("does not overthink a simple food comparison", () => {
  assert.equal(effort("Should I make chicken or salmon for dinner?"), "medium");
});

test("treats the configured model effort as a ceiling", () => {
  const decision =
    "Should I accept this job offer? Compare salary, commute, workload, career growth, and stability.";
  assert.equal(effort(decision, { ceiling: "xhigh" }), "xhigh");
  assert.equal(effort(decision, { ceiling: "high" }), "high");
  assert.equal(
    effort("How does compound interest work?", { ceiling: "low" }),
    "low",
  );
  assert.equal(effort(decision, { ceiling: "none" }), "none");
});
