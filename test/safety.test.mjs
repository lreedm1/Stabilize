import test from "node:test";
import assert from "node:assert/strict";
import { classifyInput, fixedReplyForRoute } from "../src/safety.js";

test("routes explicit current self-harm intent to immediate danger", () => {
  assert.equal(classifyInput("I am going to kill myself tonight"), "IMMEDIATE_DANGER");
});


test("treats suicidal language without a time marker as safety-unclear", () => {
  assert.equal(classifyInput("I am suicidal"), "SAFETY_UNCLEAR");
  assert.equal(classifyInput("I want to die"), "SAFETY_UNCLEAR");
});

test("routes imminent pill-taking and self-harm method requests to human help", () => {
  assert.equal(
    classifyInput("I am about to take all my pills"),
    "IMMEDIATE_DANGER",
  );
  assert.equal(
    classifyInput("How can I kill myself?"),
    "IMMEDIATE_DANGER",
  );
});

test("does not treat a clearly historical disclosure as current intent", () => {
  assert.equal(
    classifyInput("I attempted suicide five years ago, but I am safe now"),
    "ORDINARY",
  );
  assert.equal(
    classifyInput("I wanted to kill myself five years ago, but I am safe now"),
    "ORDINARY",
  );
});

test("routes a recent attempt to urgent medical help", () => {
  assert.equal(
    classifyInput("I attempted suicide last night"),
    "MEDICAL_EMERGENCY",
  );
});

test("asks a bounded safety question when safety is unclear", () => {
  assert.equal(classifyInput("I am not sure I can stay safe"), "SAFETY_UNCLEAR");
  assert.equal(classifyInput("Why should I live?"), "SAFETY_UNCLEAR");
  assert.match(fixedReplyForRoute("SAFETY_UNCLEAR").reply, /next few hours/i);
});

test("interprets yes or unsure after a safety question as danger", () => {
  assert.equal(
    classifyInput("yes", { awaitingSafetyAnswer: true }),
    "IMMEDIATE_DANGER",
  );
  assert.equal(
    classifyInput("unsure", { awaitingSafetyAnswer: true }),
    "IMMEDIATE_DANGER",
  );
});

test("interprets no after a safety question as confirmed", () => {
  assert.equal(
    classifyInput("No, I am safe", { awaitingSafetyAnswer: true }),
    "SAFETY_CONFIRMED",
  );
});

test("routes overdose and breathing emergencies without model generation", () => {
  assert.equal(classifyInput("I took too many pills"), "MEDICAL_EMERGENCY");
  assert.equal(classifyInput("I can't breathe"), "MEDICAL_EMERGENCY");
});

test("routes medication-change requests to a fixed professional handoff", () => {
  assert.equal(classifyInput("How should I taper my medication?"), "MEDICATION_CHANGE");
  assert.match(fixedReplyForRoute("MEDICATION_CHANGE").reply, /pharmacist|prescriber/i);
});

test("detects food and sleep floor breaches", () => {
  assert.equal(classifyInput("I haven't eaten all day"), "FLOOR_FOOD");
  assert.equal(classifyInput("I haven't slept and I feel awful"), "FLOOR_REST");
});

test("detects low sleep plus a consequential decision", () => {
  assert.equal(
    classifyInput("I haven't slept and I want to quit school tonight"),
    "LOW_SLEEP_URGENCY",
  );
});
