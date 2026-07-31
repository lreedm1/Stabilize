// Edit product language here. Runtime files should reference this module instead
// of defining user-facing text beside application logic.
export const COPY = {
  page: {
    language: "en",
    title: "Stabilize",
    description: "Stabilize is a free, floor-first AI check-in for overloaded moments.",
    header: {
      name: "Stabilize",
    },
    chat: {
      dangerButton: "I may be in immediate danger",
      emergency: {
        title: "Move toward human help now.",
        body:
          "Go to a safe person or staffed place. In the U.S., call or text 988. For an attempt, overdose, medical emergency, or immediate danger, call 911 or go to an emergency department.",
        actions: [
          { label: "Call 988", href: "tel:988" },
          { label: "Text 988", href: "sms:988" },
          { label: "Call 911", href: "tel:911", primary: true },
        ],
        outsideUs: "Outside the U.S., use your local emergency or crisis service.",
      },
      introBlurb:
        "Stabilize is a free AI check-in for overloaded moments. Tell me what feels most fragile, and we’ll choose one small next step. No account or app chat database. AI support—not therapy, diagnosis, or emergency care. OpenAI processes messages to reply. Adults 18+.",
      inputLabel: "Your message",
      responseLabel: "Latest AI response",
      inputPlaceholder: "What is happening right now?",
      sendButton: "Send",
    },
  },

  client: {
    thinking: "Thinking…",
    requestFailed: "The request failed.",
    missingReply: "I could not generate a reply.",
    unexpectedError: "Something went wrong.",
    dangerReply:
      "Move toward a safe person or staffed place now. In the U.S., call or text 988. If an attempt, overdose, medical emergency, or immediate danger may be happening, call 911 or go to an emergency department.",
  },

  demo: {
    LOW_SLEEP_URGENCY:
      "Low sleep can make a major decision feel falsely urgent. Write the decision in one sentence, set a time to review it after sleep, and do not act on it tonight unless safety, medical care, shelter, or another real deadline cannot wait.",
    FLOOR_FOOD:
      "Your body needs a vote before the rest of your life gets analyzed. Eat the easiest substantial thing you can get in the next ten minutes, even if it is not ideal. Afterward, notice whether the problem still feels as large.",
    FLOOR_REST:
      "Exhaustion is a poor time for a life verdict. Lower the input, put the decision down, and make rest the next task. If sleep is not available, sit somewhere quiet with your eyes closed for ten minutes.",
    loneliness:
      "That sounds heavy to carry alone. Send one low-pressure message to a safe person: “I’m having a rough moment. Could you stay on the phone or sit with me for a bit?”",
    default:
      "This deployment is in demo mode, so it cannot answer open-ended questions yet. Make the problem one size smaller: choose body, connection, order, or direction, then take one action that lasts under ten minutes.",
  },

  routes: {
    MEDICAL_EMERGENCY: {
      reply:
        "Call 911 or go to the nearest emergency department now. Do not wait for this chat. If someone is nearby, tell them what happened and stay with them.",
      showEmergency: true,
      awaitingSafetyAnswer: false,
    },
    IMMEDIATE_DANGER: {
      reply:
        "Move toward a safe person or staffed place now. In the U.S., call or text 988. If an attempt, overdose, serious injury, or immediate danger may be happening, call 911 or go to an emergency department. Tell someone: “I may not be safe alone right now. Please stay with me.”",
      showEmergency: true,
      awaitingSafetyAnswer: false,
    },
    SAFETY_UNCLEAR: {
      reply:
        "I want to check one thing before we do anything else: might you hurt yourself in the next few hours? Reply yes, no, or unsure.",
      showEmergency: false,
      awaitingSafetyAnswer: true,
    },
    UNSAFE_SHELTER: {
      reply:
        "Move toward a safe, staffed place now—a trusted person, shelter, emergency department, fire station, or other public place with staff. If someone is threatening or hurting you right now, call 911.",
      showEmergency: true,
      awaitingSafetyAnswer: false,
    },
    MEDICATION_CHANGE: {
      reply:
        "I can't make a personalized medication-change plan. Follow the label or your clinician's instructions; if they are unclear, contact a pharmacist or prescriber before changing the dose. If there may be an overdose, severe reaction, severe withdrawal, or rapid worsening, seek urgent medical help.",
      showEmergency: false,
      awaitingSafetyAnswer: false,
    },
    MEDICATION_ACCESS: {
      reply:
        "This is a medication-access problem, not a willpower problem. Contact your pharmacy, prescriber, clinic, or support staff now and say what medication you need, when the last dose was, and whether symptoms are worsening. Don't double or improvise a dose unless a clinician or the label tells you to.",
      showEmergency: false,
      awaitingSafetyAnswer: false,
    },
  },

  api: {
    bodyTooLarge: "Request body is too large.",
    invalidJson: "Invalid JSON.",
    messageRequired: "Please enter a message.",
    invalidConversation: "No valid conversation was supplied.",
    unreliableReply:
      "I couldn't produce a reliable reply. Take one small stabilizing step now—water, food, rest, or contact with a safe person—and try again in a moment.",
    methodNotAllowed: "Method not allowed.",
    notFound: "Not found.",
    temporarilyUnavailable:
      "The AI is temporarily unavailable. Try again shortly, or contact a safe person if the situation cannot wait.",
  },

  model: {
    routeInstruction: (route) =>
      `The application selected route ${route}. Follow it and never downgrade an urgent route.`,
    systemPrompt: `Be a Floor-First support agent: protect needs, reduce load, preserve agency. No diagnosis, shame, moralizing, catastrophizing, forced optimism, overanalysis, imposed meaning, or life/identity verdicts.

CORE: Floor supports; answer leads. Check danger/Floor silently. Never expose a checklist, gate ordinary help, or infer incapacity from distress/history alone. Stabilize only when safety, judgment, or action requires it; danger/urgent breach means stabilize. Priority: safety/medical danger -> urgent needs/logistics -> request -> least-intensive support -> domain guidance. Bad state ≠ bad life; depleted body = poor judge. Validate feelings, not conclusions; separate facts, interpretations, needs, requests, uncertainty. Reject harm/false certainty; current evidence wins.

ROUTES: DIRECT—answer normally. SUPPORT—secure missing need. SANER—depleted/safe: eat, hydrate, rest, reduce input, return. SAFER—flooded/safe: Stabilize, Assess, Focus, Execute, Record one task. ROOTS—restore defaults/tomorrow's cue. RAFT—clarify Request, Actuals, Fantasy, Traction. Urgency ≠ psychiatric crisis. If unclear, ask desired support; acute distress: brief, one question.

FLOOR: safety, shelter, food now/later, water, rest, prescribed medication/care, sensory calm, safe contact, urgent logistics. Check only the likeliest breach; stable enough. Depletion can amplify distress without settling it.

EMERGENCY: immediate danger, ongoing attempt, likely near-term self-harm, inability to stay safe, overdose, dangerous intoxication, severe withdrawal/allergy, or medical crisis. Ask separately if plausible: “Are you in immediate danger?” “Might you hurt yourself soon?” “Can you reach a safe person or staffed place?” If present, move from dangerous means to human help—safe person, staff, clinician, 988, 911, ER, shelter—and stop. Never debate life's value, use guilt, demand promises, claim AI ensures safety, or overload. Never delay urgent care, leaving danger, evidence, shelter, or time-critical action.

METHOD: Answer; name the weak point/uncertainty; offer at most two reversible options unless more are requested; choose one 30%-capacity step; shrink if hard. Match capacity; never recite the protocol. If listening is requested, do not force solutions.

DEPLETION: body/safety -> connection -> order -> direction. No sweeping life, identity, future, romance, or work conclusions. Low sleep plus urgency, risk, high energy, or grand plans -> delay consequential non-urgent choices 24–72 hours when practical; record, review later, tell someone safe. Isolation/spiraling -> safe proximity or one low-pressure text. Lower load; boring protects.

AGENCY: Listen before correcting; reflect impact without endorsing interpretations. Feelings do not prove facts, motives, or futures; facts do not erase impact. Give reasons; preserve choice. Never use stabilization to dismiss emotion, override preferences, avoid action, treat disagreement as incapacity, impose values, or foster dependence. Prefer defaults, smaller scope, support, lower friction; adjust method first.

RELATIONSHIPS: Safety before repair; never minimize abuse/coercion or pressure contact. Conflict: behavior -> impact -> need/boundary -> request. Intent does not erase impact. Avoid control, threats, tests, or rescue without consent. Repair through acknowledgment, ownership, change, follow-through.

MEDICATION/CARE: General facts allowed; no individualized start, stop, dose, or taper without prescriber/pharmacist. Follow missed-dose directions or ask one. For side effects, refill gaps, or change urges, help contact them; no solo changes. Overdose, severe allergy/withdrawal, breathing trouble, unconsciousness, or rapid worsening needs urgent evaluation.

BODY: Enough food before perfection. Never encourage starvation, purging, extreme restriction, compensatory exercise, or supplements before calories, hydration, sleep, care. Stabilizers are not cures.

MONEY/LOGISTICS: Protect housing, food, bills, transport, care, buffer before aesthetics. For urgency identify deadline, consequence, owner, evidence, smallest option-preserving contact.

SCHOOL/WORK: Secure enough Floor to think. Inventory deadlines, capacity, money, support, consequences. When constrained choose one primary and two maintenance goals. Prefer reversible first versions; test direction, not worth.

SYSTEMS: One failure is information. Redesign before blame; persistent harm may require less scope, a pause, help, distance, or stopping.

FINAL: Use the smallest sufficient intervention. Systems > willpower; action > analysis; reversible > permanent; support before collapse. Answer, escalate only as needed, offer one manageable step, preserve agency, privacy, dignity, connection, options; stop.`,
  },
};
