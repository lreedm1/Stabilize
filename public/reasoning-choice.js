const REASONING_STORAGE_KEY = "stabilize:reasoning-effort:v1";
const DEFAULT_REASONING_EFFORT = "none";
const CURRENT_MODEL_PATTERN = /^gpt-5\.6(?:-|$)/i;
const REASONING_OPTIONS = Object.freeze([
  { value: "none", label: "Fastest response", shortLabel: "Fastest" },
  { value: "low", label: "Think briefly", shortLabel: "Brief" },
  { value: "medium", label: "Think", shortLabel: "Think" },
  { value: "high", label: "Think deeply", shortLabel: "Deep" },
  { value: "xhigh", label: "Think longest", shortLabel: "Longest" },
  {
    value: "max",
    label: "Think maximum (Current only)",
    shortLabel: "Maximum",
    currentOnly: true,
  },
]);
const REASONING_VALUES = new Set(REASONING_OPTIONS.map(({ value }) => value));
let memoryEffort = DEFAULT_REASONING_EFFORT;

function normalizeEffort(value) {
  const effort = String(value || "").trim().toLowerCase();
  return REASONING_VALUES.has(effort) ? effort : DEFAULT_REASONING_EFFORT;
}

function readEffort() {
  try {
    memoryEffort = normalizeEffort(localStorage.getItem(REASONING_STORAGE_KEY));
  } catch {
    memoryEffort = normalizeEffort(memoryEffort);
  }
  return memoryEffort;
}

function storeEffort(value) {
  memoryEffort = normalizeEffort(value);
  try {
    localStorage.setItem(REASONING_STORAGE_KEY, memoryEffort);
  } catch {
    // A page-local preference still works when persistent storage is unavailable.
  }
  return memoryEffort;
}

function publishReasoningEffort(value) {
  const effort = normalizeEffort(value);
  if (document.documentElement.dataset.reasoningEffort !== effort) {
    document.documentElement.dataset.reasoningEffort = effort;
  }
  return effort;
}

function selectedModelIds() {
  return [...document.querySelectorAll('select[name="model"]')]
    .filter((select) => select instanceof HTMLSelectElement)
    .map((select) => select.value);
}

function currentModelSupportsMaximum() {
  return selectedModelIds().some((model) => CURRENT_MODEL_PATTERN.test(model));
}

function effortForSelectedModel(value) {
  const effort = normalizeEffort(value);
  return effort === "max" && !currentModelSupportsMaximum() ? "xhigh" : effort;
}

function isChatRequest(input) {
  try {
    const value = input instanceof Request ? input.url : input;
    const url = new URL(String(value), window.location.href);
    return url.origin === window.location.origin && url.pathname === "/api/chat";
  } catch {
    return false;
  }
}

async function chatRequestWithReasoning(input, init) {
  const reasoningEffort = effortForSelectedModel(readEffort());

  if (input instanceof Request) {
    const contentType = input.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) return [input, init];
    try {
      const body = JSON.parse(await input.clone().text());
      body.reasoningEffort = reasoningEffort;
      const headers = new Headers(input.headers);
      headers.set("Content-Type", "application/json");
      return [
        new Request(input, {
          body: JSON.stringify(body),
          headers,
        }),
        undefined,
      ];
    } catch {
      return [input, init];
    }
  }

  if (typeof init?.body !== "string") return [input, init];
  try {
    const body = JSON.parse(init.body);
    body.reasoningEffort = reasoningEffort;
    return [
      input,
      {
        ...init,
        body: JSON.stringify(body),
      },
    ];
  } catch {
    return [input, init];
  }
}

const previousFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  if (!isChatRequest(input)) return previousFetch(input, init);
  const [nextInput, nextInit] = await chatRequestWithReasoning(input, init);
  return previousFetch(nextInput, nextInit);
};

function optionForEffort(effort) {
  return (
    REASONING_OPTIONS.find(({ value }) => value === normalizeEffort(effort)) ||
    REASONING_OPTIONS[0]
  );
}

function modelLabelForPicker(picker) {
  const modelSelect = picker.querySelector('select[name="model"]');
  const selectedLabel = modelSelect instanceof HTMLSelectElement
    ? modelSelect.selectedOptions[0]?.textContent
    : "";
  const current = picker.querySelector(".composer-model-current");
  const existing = current instanceof HTMLElement
    ? current.dataset.baseModelLabel || current.textContent
    : "";
  const raw = String(selectedLabel || existing || "GPT-5.4")
    .replace(/\s*\(default\)\s*/i, "")
    .trim();
  if (/^default$/i.test(raw)) return "5.4";
  return raw.replace(/^GPT-/i, "");
}

function updateComposerSummary() {
  const effort = optionForEffort(effortForSelectedModel(readEffort()));
  for (const picker of document.querySelectorAll("details.composer-model-picker")) {
    if (!(picker instanceof HTMLDetailsElement)) continue;
    const current = picker.querySelector(".composer-model-current");
    const summary = picker.querySelector("summary");
    if (!(current instanceof HTMLElement)) continue;
    const modelLabel = modelLabelForPicker(picker);
    const nextText = `${modelLabel} · ${effort.shortLabel}`;
    const nextAriaLabel =
      `Choose AI model and thinking level. Current: ${modelLabel}, ${effort.label}.`;
    current.dataset.baseModelLabel = modelLabel;
    if (current.textContent !== nextText) current.textContent = nextText;
    if (
      summary instanceof HTMLElement &&
      summary.getAttribute("aria-label") !== nextAriaLabel
    ) {
      summary.setAttribute("aria-label", nextAriaLabel);
    }
  }
}

function synchronizeMaximumOptions() {
  const enabled = currentModelSupportsMaximum();
  for (const select of document.querySelectorAll("[data-reasoning-choice]")) {
    if (!(select instanceof HTMLSelectElement)) continue;
    const maximum = select.querySelector('option[value="max"]');
    if (
      maximum instanceof HTMLOptionElement &&
      maximum.disabled !== !enabled
    ) {
      maximum.disabled = !enabled;
    }
  }
  return enabled;
}

function synchronizeSelectors(effort) {
  synchronizeMaximumOptions();
  let selected = normalizeEffort(effort);
  if (selected === "max" && !currentModelSupportsMaximum()) {
    selected = storeEffort("xhigh");
  }
  selected = publishReasoningEffort(selected);
  for (const select of document.querySelectorAll("[data-reasoning-choice]")) {
    if (
      select instanceof HTMLSelectElement &&
      select.value !== selected
    ) {
      select.value = selected;
    }
  }
  updateComposerSummary();
}

function thinkingControl(index) {
  const wrapper = document.createElement("div");
  wrapper.className = "thinking-choice";

  const heading = document.createElement("div");
  heading.className = "thinking-choice-heading";

  const label = document.createElement("label");
  const id = `thinking-choice-${index}`;
  label.htmlFor = id;
  label.textContent = "Thinking";

  const free = document.createElement("span");
  free.className = "thinking-choice-free";
  free.textContent = "Free at every level";
  heading.append(label, free);

  const select = document.createElement("select");
  select.id = id;
  select.dataset.reasoningChoice = "true";
  select.setAttribute("aria-describedby", `${id}-description`);
  for (const option of REASONING_OPTIONS) {
    const element = document.createElement("option");
    element.value = option.value;
    element.textContent = option.label;
    if (option.currentOnly) element.dataset.currentOnly = "true";
    select.appendChild(element);
  }
  select.value = effortForSelectedModel(readEffort());
  select.addEventListener("change", () => {
    synchronizeSelectors(storeEffort(select.value));
  });

  const description = document.createElement("p");
  description.id = `${id}-description`;
  description.className = "thinking-choice-description";
  description.textContent =
    "Fastest response disables extra reasoning. Network and model startup can still take a moment; higher levels take longer. Maximum is available with Current.";

  wrapper.append(heading, select, description);
  return wrapper;
}

function mountThinkingControls() {
  const containers = [
    ...document.querySelectorAll(".composer-model-panel, .billing-menu"),
  ];
  containers.forEach((container, index) => {
    if (!(container instanceof HTMLElement) || container.dataset.thinkingMounted) {
      return;
    }
    container.dataset.thinkingMounted = "true";
    const control = thinkingControl(index + 1);
    const modelForm = container.querySelector(".model-choice-form");
    if (modelForm instanceof HTMLElement) {
      modelForm.insertAdjacentElement("afterend", control);
    } else {
      container.appendChild(control);
    }
  });
  synchronizeSelectors(readEffort());
}

document.addEventListener("change", (event) => {
  const target = event.target;
  if (target instanceof HTMLSelectElement && target.name === "model") {
    for (const current of document.querySelectorAll(".composer-model-current")) {
      if (current instanceof HTMLElement) delete current.dataset.baseModelLabel;
    }
    synchronizeSelectors(readEffort());
  }
});

window.addEventListener("storage", (event) => {
  if (event.key === REASONING_STORAGE_KEY) {
    synchronizeSelectors(normalizeEffort(event.newValue));
  }
});

function initializeThinkingControls() {
  mountThinkingControls();
}

if (document.readyState === "loading") {
  document.addEventListener(
    "DOMContentLoaded",
    initializeThinkingControls,
    { once: true },
  );
} else {
  initializeThinkingControls();
}
