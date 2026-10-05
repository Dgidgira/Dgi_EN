// Страница просмотра записи: шаги со скриншотами и подсветкой элемента (FR-2).
// Текст шага — шаблонное описание (FR-3, shared/describe.js).

const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

const SHOT_PREFIX = "shot:";
// Запас вокруг элемента, чтобы рамка не перекрывала его край, в CSS-пикселях страницы
const HIGHLIGHT_PADDING = 4;

const stepsEl = document.getElementById("steps");
const emptyEl = document.getElementById("empty");
const statsEl = document.getElementById("stats");

document.title = t("viewerTitle");
document.getElementById("title").textContent = t("viewerTitle");
emptyEl.textContent = t("viewerEmpty");

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Рамка в процентах от видимой области страницы на момент снимка
function highlightStyle(rect, viewport) {
  const left = Math.max(0, rect.x - HIGHLIGHT_PADDING);
  const top = Math.max(0, rect.y - HIGHLIGHT_PADDING);
  const right = Math.min(viewport.width, rect.x + rect.width + HIGHLIGHT_PADDING);
  const bottom = Math.min(viewport.height, rect.y + rect.height + HIGHLIGHT_PADDING);
  return {
    left: (left / viewport.width) * 100 + "%",
    top: (top / viewport.height) * 100 + "%",
    width: ((right - left) / viewport.width) * 100 + "%",
    height: ((bottom - top) / viewport.height) * 100 + "%",
  };
}

function isVisibleInViewport(rect, viewport) {
  return rect.width > 0 && rect.height > 0 &&
    rect.x < viewport.width && rect.y < viewport.height &&
    rect.x + rect.width > 0 && rect.y + rect.height > 0;
}

function renderShot(step, dataUrl) {
  if (!dataUrl) {
    const reason = step.screenshotError ? `: ${step.screenshotError}` : "";
    return el("p", "no-shot", t("viewerNoScreenshot") + reason);
  }
  const wrap = el("div", "shot");
  const img = el("img");
  img.src = dataUrl;
  img.alt = step.label;
  wrap.append(img);

  if (step.rect && step.viewport && isVisibleInViewport(step.rect, step.viewport)) {
    const frame = el("div", "shot-highlight");
    Object.assign(frame.style, highlightStyle(step.rect, step.viewport));
    wrap.append(frame);
  }
  return wrap;
}

function renderStep(step, index, dataUrl) {
  const item = el("li", "step");
  const description = describeStep(step);

  const head = el("p", "step-head");
  head.append(el("span", "step-number", t("viewerStepNumber", [String(index + 1)])));
  head.append(el("span", "step-text", description.text));
  item.append(head);

  item.append(renderShot(step, dataUrl));

  // Данные шага для анализа в спайке (SQ-5): откуда взята подпись, что записано
  const debug = el("details", "step-debug");
  debug.append(el("summary", null, t("viewerDebugToggle")));
  const meta = [step.type, step.label ? `«${step.label}»` : ""];
  if (step.value !== null && step.value !== undefined) meta.push(`= «${step.value}»`);
  meta.push(t("viewerLabelSource", [step.labelSource]));
  meta.push(step.page?.url || "");
  debug.append(el("p", "step-meta", meta.filter(Boolean).join(" · ")));
  item.append(debug);

  return item;
}

// Сводка для SQ-5: у скольких шагов описание удалось построить с подписью элемента
function renderStats(steps) {
  const withLabel = steps.filter((step) => describeStep(step).usesLabel).length;
  statsEl.textContent = t("viewerLabelStats", [String(withLabel), String(steps.length)]);
  statsEl.hidden = steps.length === 0;
}

async function render() {
  const { steps = [] } = await chrome.storage.local.get("steps");
  const shotKeys = steps.map((step) => SHOT_PREFIX + step.id);
  const shots = shotKeys.length ? await chrome.storage.local.get(shotKeys) : {};

  emptyEl.hidden = steps.length > 0;
  renderStats(steps);
  stepsEl.replaceChildren(...steps.map((step, i) => renderStep(step, i, shots[SHOT_PREFIX + step.id])));
}

render();

// Страница обновляется сама, пока идёт запись
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && "steps" in changes) render();
});
