// Страница просмотра записи: шаги со скриншотами и подсветкой элемента (FR-2).
// Перед показом шаги проходят обработку (SQ-1, SQ-2, shared/normalize.js), текст шага —
// шаблонное описание (FR-3, shared/describe.js). Отмеченные автором поля размываются на всех
// скриншотах и скрываются в описаниях; произвольные области размываются на своём скриншоте
// (FR-6, shared/mask.js).

const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

const SHOT_PREFIX = "shot:";
// Запас вокруг элемента, чтобы рамка не перекрывала его край, в CSS-пикселях страницы
const HIGHLIGHT_PADDING = 4;
// Запас размытия вокруг поля: захватываем рамку поля, чтобы край текста не выглядывал
const MASK_PADDING = 1;

const stepsEl = document.getElementById("steps");
const emptyEl = document.getElementById("empty");
const statsEl = document.getElementById("stats");
const droppedEl = document.getElementById("dropped");
const droppedListEl = document.getElementById("dropped-steps");
const fieldModeEl = document.getElementById("mask-mode");
const areaModeEl = document.getElementById("area-mode");
const maskCountEl = document.getElementById("mask-count");
const maskHintEl = document.getElementById("mask-hint");

// Отмеченные поля (ключ "maskedFields") и области (ключ "maskedAreas") хранятся в chrome.storage.local.
// Режим работы — только на этой странице: null, "fields" (скрытие полей) или "areas" (выделение областей).
let masks = [];
let maskedAreas = {};
let mode = null;

document.title = t("viewerTitle");
document.getElementById("title").textContent = t("viewerTitle");
emptyEl.textContent = t("viewerEmpty");
document.getElementById("dropped-title").textContent = t("viewerDroppedTitle");
document.getElementById("dropped-hint").textContent = t("viewerDroppedHint");
function setMode(next) {
  mode = mode === next ? null : next;
  render();
}

fieldModeEl.addEventListener("click", () => setMode("fields"));
areaModeEl.addEventListener("click", () => setMode("areas"));

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// Прямоугольник в долях снимка (0..1) — в проценты для CSS
function fractionStyle(rect) {
  return {
    left: rect.x * 100 + "%",
    top: rect.y * 100 + "%",
    width: rect.width * 100 + "%",
    height: rect.height * 100 + "%",
  };
}

// Прямоугольник в процентах от видимой области страницы на момент снимка
function rectStyle(rect, viewport, padding) {
  const left = Math.max(0, rect.x - padding);
  const top = Math.max(0, rect.y - padding);
  const right = Math.min(viewport.width, rect.x + rect.width + padding);
  const bottom = Math.min(viewport.height, rect.y + rect.height + padding);
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
  img.draggable = false;
  wrap.append(img);

  // Размытие поверх снимка. При выгрузке оно будет впечатано в саму картинку
  if (step.viewport) {
    for (const rect of maskedRects(step, masks)) {
      const mask = el("div", "shot-mask");
      Object.assign(mask.style, rectStyle(rect, step.viewport, MASK_PADDING));
      wrap.append(mask);
    }
  }
  areasOf(maskedAreas, step.id).forEach((area, index) => wrap.append(renderArea(step.id, area, index)));

  if (step.viewport && step.rect && isVisibleInViewport(step.rect, step.viewport)) {
    const frame = el("div", "shot-highlight");
    Object.assign(frame.style, rectStyle(step.rect, step.viewport, HIGHLIGHT_PADDING));
    wrap.append(frame);
  }

  if (mode === "fields" && step.viewport) wrap.append(...renderFieldTargets(step));
  if (mode === "areas") enableAreaDrawing(wrap, img, step.id);
  return wrap;
}

// Размытая произвольная область; в режиме выделения у неё есть кнопка удаления
function renderArea(stepId, area, index) {
  const mask = el("div", "shot-mask area");
  Object.assign(mask.style, fractionStyle(area));
  if (mode === "areas") {
    const remove = el("button", "area-remove", "×");
    remove.type = "button";
    remove.title = t("viewerMaskAreaRemove");
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", async () => {
      await chrome.storage.local.set({ maskedAreas: removeArea(maskedAreas, stepId, index) });
    });
    mask.append(remove);
  }
  return mask;
}

// Выделение прямоугольника мышью на снимке. Координаты — в долях размера снимка
function enableAreaDrawing(wrap, img, stepId) {
  wrap.classList.add("drawing");
  wrap.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".area-remove")) return;
    event.preventDefault();
    const box = img.getBoundingClientRect();
    const toPoint = (e) => ({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height });
    const start = toPoint(event);
    const draft = el("div", "area-draft");
    wrap.append(draft);
    wrap.setPointerCapture(event.pointerId);

    const onMove = (e) => {
      const area = areaFromPoints(start, toPoint(e));
      draft.hidden = !area;
      if (area) Object.assign(draft.style, fractionStyle(area));
    };
    const onEnd = async (e) => {
      wrap.removeEventListener("pointermove", onMove);
      wrap.removeEventListener("pointerup", onEnd);
      wrap.removeEventListener("pointercancel", onEnd);
      draft.remove();
      const area = e.type === "pointerup" ? areaFromPoints(start, toPoint(e)) : null;
      if (area) await chrome.storage.local.set({ maskedAreas: addArea(maskedAreas, stepId, area) });
    };
    draft.hidden = true;
    wrap.addEventListener("pointermove", onMove);
    wrap.addEventListener("pointerup", onEnd);
    wrap.addEventListener("pointercancel", onEnd);
  });
}

// Режим скрытия: пунктирные области всех полей на снимке; клик скрывает поле на всех снимках
function renderFieldTargets(step) {
  const pageKeyOfStep = pageKey(step.page?.url);
  // Области только по видимым частям поля: под раскрытым списком щелчок должен попадать в список, а не в поле
  return (step.fields || []).flatMap((field) => {
    const masked = isFieldMasked(field, masks, pageKeyOfStep);
    const name = field.fieldLabel || t("viewerMaskFieldUnnamed");
    const title = t(masked ? "viewerMaskFieldShow" : "viewerMaskFieldHide", [name]);
    return visibleFieldRects(field).map((rect) => {
      const target = el("button", masked ? "shot-field masked" : "shot-field");
      target.type = "button";
      target.title = title;
      target.setAttribute("aria-label", title);
      Object.assign(target.style, rectStyle(rect, step.viewport, MASK_PADDING));
      target.addEventListener("click", async () => {
        await chrome.storage.local.set({ maskedFields: toggleMask(masks, field, step.page?.url) });
      });
      return target;
    });
  });
}

// number — номер шага в инструкции; у отсеянного шага номера нет, вместо него причина отсева
function renderStep(rawStep, { number = null, reason = null, dataUrl }) {
  // Значения отмеченных полей не показываем нигде, включая технические подробности
  const step = maskStep(rawStep, masks);
  const item = el("li", reason ? "step dropped" : "step");
  const description = describeStep(step);

  const head = el("p", "step-head");
  if (number !== null) head.append(el("span", "step-number", t("viewerStepNumber", [String(number)])));
  head.append(el("span", "step-text", description.text));
  item.append(head);
  if (reason) item.append(el("p", "step-reason", t(reason)));

  item.append(renderShot(step, dataUrl));

  // Данные шага для анализа в спайке (SQ-5): откуда взята подпись, что записано
  const debug = el("details", "step-debug");
  debug.append(el("summary", null, t("viewerDebugToggle")));
  const meta = [step.type, step.label ? `«${step.label}»` : ""];
  if (step.value !== null && step.value !== undefined) meta.push(`= «${step.value}»`);
  meta.push(t("viewerLabelSource", [step.labelSource]));
  if (step.mergedFrom?.length) meta.push(`+${step.mergedFrom.length}`);
  if (step.element?.path) meta.push(step.element.path);
  if (step.screenshotSource) meta.push(t("viewerShotSource", [step.screenshotSource]));
  meta.push(step.page?.url || "");
  debug.append(el("p", "step-meta", meta.filter(Boolean).join(" · ")));
  item.append(debug);

  return item;
}

// Сводка: SQ-5 — у скольких шагов описание построено с подписью элемента; SQ-2 — сколько отсеяно
function renderStats(steps, dropped) {
  const withLabel = steps.filter((step) => describeStep(step).usesLabel).length;
  statsEl.textContent = [
    t("viewerLabelStats", [String(withLabel), String(steps.length)]),
    t("viewerDroppedStats", [String(dropped.length)]),
  ].join(" · ");
  statsEl.hidden = steps.length + dropped.length === 0;
}

function renderMaskToolbar() {
  fieldModeEl.textContent = t(mode === "fields" ? "viewerMaskModeDone" : "viewerMaskModeStart");
  fieldModeEl.setAttribute("aria-pressed", String(mode === "fields"));
  areaModeEl.textContent = t(mode === "areas" ? "viewerMaskModeDone" : "viewerMaskAreaStart");
  areaModeEl.setAttribute("aria-pressed", String(mode === "areas"));
  maskHintEl.hidden = !mode;
  maskHintEl.textContent = mode === "areas" ? t("viewerMaskAreaHint") : t("viewerMaskHint");
  maskCountEl.textContent = [
    t("viewerMaskedStats", [String(masks.length)]),
    t("viewerMaskedAreasStats", [String(countAreas(maskedAreas))]),
  ].join(" · ");
}

async function render() {
  const stored = await chrome.storage.local.get(["steps", "maskedFields", "maskedAreas"]);
  const { steps: rawSteps = [], maskedFields = [] } = stored;
  masks = maskedFields;
  maskedAreas = stored.maskedAreas || {};
  renderMaskToolbar();
  const { steps, dropped } = normalizeSteps(rawSteps);
  const shotKeys = rawSteps.map((step) => SHOT_PREFIX + step.id);
  const shots = shotKeys.length ? await chrome.storage.local.get(shotKeys) : {};
  const shotOf = (step) => shots[SHOT_PREFIX + step.id];

  emptyEl.hidden = rawSteps.length > 0;
  renderStats(steps, dropped);
  stepsEl.replaceChildren(...steps.map((step, i) => renderStep(step, { number: i + 1, dataUrl: shotOf(step) })));

  // Раздел сохраняет состояние «раскрыт / свёрнут» при обновлении во время записи
  droppedEl.hidden = dropped.length === 0;
  droppedListEl.replaceChildren(...dropped.map(({ step, reason }) => renderStep(step, { reason, dataUrl: shotOf(step) })));
}

render();

// Страница обновляется сама, пока идёт запись
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && ["steps", "maskedFields", "maskedAreas"].some((key) => key in changes)) render();
});
