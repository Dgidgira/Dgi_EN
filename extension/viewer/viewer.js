// Страница просмотра записи: шаги со скриншотами и подсветкой элемента (FR-2).
// Перед показом шаги проходят обработку (SQ-1, SQ-2, shared/normalize.js), текст шага —
// шаблонное описание (FR-3, shared/describe.js). Отмеченные автором поля размываются на всех
// скриншотах и скрываются в описаниях; произвольные области размываются на своём скриншоте
// (FR-6, shared/mask.js). Соседние шаги можно объединить под одним скриншотом (FR-7, shared/groups.js),
// скриншот можно кадрировать (FR-7, shared/crop.js). Шаги делятся на разделы, созданные во время записи;
// название раздела можно исправить, раздел — удалить (FR-10, shared/sections.js).

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
// Шаги, объединённые с предыдущим под одним скриншотом (ключ "joinedSteps")
let joinedSteps = [];
// Кадры скриншотов (ключ "crops"): { [id шага со скриншотом]: рамка в долях снимка }
let crops = {};
// Разделы инструкции (ключ "sections"): [{ id, title, timestamp }]
let sections = [];
// Последнее показанное состояние: из него собирается выгружаемый документ (viewer/export.js)
// parts — разделы с группами шагов, groups — все группы подряд
let current = { parts: [], groups: [], shotOf: () => null, rawSteps: [] };
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

// Рамка шага на его собственном скриншоте
function ownFrames(step) {
  const visible = step.viewport && step.rect && isVisibleInViewport(step.rect, step.viewport);
  return visible ? [{ rect: step.rect, number: null }] : [];
}

// Доля снимка, которую занимает номер шага рядом с рамкой (с запасом на уменьшение снимка в просмотре)
const BADGE_SPACE = 0.04;

// Где поставить номер шага у рамки, чтобы он не закрывал содержимое элемента:
// справа (там у полей обычно пусто), иначе слева, иначе сверху, в крайнем случае внутри
function badgeSide(rect, viewport) {
  const spaceX = BADGE_SPACE * viewport.width;
  const spaceY = BADGE_SPACE * viewport.height;
  if (rect.x + rect.width + spaceX < viewport.width) return "side-right";
  if (rect.x - spaceX > 0) return "side-left";
  if (rect.y - spaceY > 0) return "side-top";
  return "side-inside";
}

// Размытые области своего скриншота: [{ stepId, index, area }]
function ownAreas(step) {
  return areasOf(maskedAreas, step.id).map((area, index) => ({ stepId: step.id, index, area }));
}

// frames — рамки на снимке: [{ rect, number }]; у группы шагов на рамке номер шага.
// areas — размытые области: у группы сюда входят и области, выделенные на скриншотах ранних шагов.
// crop — кадр (null — весь снимок). interactive — можно ли отмечать поля и области (нет в окне кадрирования).
function renderShot(step, dataUrl, options = {}) {
  const { frames = ownFrames(step), areas = ownAreas(step), crop = null, interactive = true } = options;
  if (!dataUrl) {
    const reason = step.screenshotError ? `: ${step.screenshotError}` : "";
    return el("p", "no-shot", t("viewerNoScreenshot") + reason);
  }
  // wrap — видимое окно снимка; stage — весь снимок со всеми слоями поверх него.
  // При кадрировании stage увеличивается и сдвигается внутри wrap, слои двигаются вместе со снимком.
  const wrap = el("div", "shot");
  const stage = el("div", "shot-stage");
  wrap.append(stage);
  const img = el("img");
  img.src = dataUrl;
  img.alt = step.label;
  img.draggable = false;
  stage.append(img);

  // Размытие поверх снимка. При выгрузке оно будет впечатано в саму картинку
  if (step.viewport) {
    for (const rect of maskedRects(step, masks)) {
      const mask = el("div", "shot-mask");
      Object.assign(mask.style, rectStyle(rect, step.viewport, MASK_PADDING));
      stage.append(mask);
    }
  }
  for (const { stepId, index, area } of areas) stage.append(renderArea(stepId, area, index, interactive));

  for (const { rect, number } of frames) {
    const frame = el("div", "shot-highlight");
    Object.assign(frame.style, rectStyle(rect, step.viewport, HIGHLIGHT_PADDING));
    if (number !== null) frame.append(el("span", `frame-number ${badgeSide(rect, step.viewport)}`, String(number)));
    stage.append(frame);
  }

  if (interactive && mode === "fields" && step.viewport) stage.append(...renderFieldTargets(step));
  if (interactive && mode === "areas") enableAreaDrawing(wrap, stage, img, step.id);
  if (!isFullCrop(crop)) applyCropView(wrap, stage, img, step, crop);
  return wrap;
}

// Показ кадра: окно снимка получает пропорции кадра, весь снимок увеличивается и сдвигается внутри
function applyCropView(wrap, stage, img, step, crop) {
  wrap.classList.add("cropped");
  Object.assign(stage.style, {
    width: 100 / crop.width + "%",
    height: 100 / crop.height + "%",
    left: (-crop.x / crop.width) * 100 + "%",
    top: (-crop.y / crop.height) * 100 + "%",
  });
  const setSize = (width, height) => {
    wrap.style.aspectRatio = `${width * crop.width} / ${height * crop.height}`;
  };
  if (step.viewport) setSize(step.viewport.width, step.viewport.height);
  // Кадр показываем в том же масштабе, что и некадрированный снимок, но не шире карточки
  img.addEventListener("load", () => {
    setSize(img.naturalWidth, img.naturalHeight);
    wrap.style.width = `min(100%, ${Math.round(img.naturalWidth * crop.width)}px)`;
  });
}

// --- Окно кадрирования: как обрезка в «Фотографиях» Windows ---

const CROP_HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
// Пропорции: ключ строки и отношение ширины к высоте в пикселях ("original" — как у снимка)
const CROP_RATIOS = [
  ["cropFree", null],
  ["cropOriginal", "original"],
  ["crop1x1", 1],
  ["crop4x3", 4 / 3],
  ["crop16x9", 16 / 9],
];

function openCropEditor(shotStep, dataUrl, frames, areas) {
  const dialog = el("dialog", "crop-dialog");
  dialog.append(el("h2", "crop-title", t("cropTitle")));
  dialog.append(el("p", "crop-hint", t("cropHint")));

  const shot = renderShot(shotStep, dataUrl, { frames, areas, interactive: false });
  shot.classList.add("crop-shot");
  const stage = shot.querySelector(".shot-stage");
  const img = shot.querySelector("img");
  const box = el("div", "crop-box");
  ["v1", "v2", "h1", "h2"].forEach((line) => box.append(el("div", `crop-third ${line}`)));
  CROP_HANDLES.forEach((handle) => {
    const node = el("div", `crop-handle h-${handle}`);
    node.dataset.handle = handle;
    box.append(node);
  });
  stage.append(box);
  dialog.append(shot);

  let crop = { ...(crops[shotStep.id] || FULL_CROP) };
  let ratio = null;
  const draw = () => Object.assign(box.style, fractionStyle(crop));
  const aspect = () => (ratio === "original" ? 1 : aspectInFractions(
    ratio, img.naturalWidth || shotStep.viewport?.width || 1, img.naturalHeight || shotStep.viewport?.height || 1));

  // Перетаскивание: за маркер — размер, за середину рамки — положение
  box.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const handle = event.target.dataset.handle || "move";
    const imageBox = img.getBoundingClientRect();
    const start = { ...crop };
    box.setPointerCapture(event.pointerId);
    const onMove = (e) => {
      const dx = (e.clientX - event.clientX) / imageBox.width;
      const dy = (e.clientY - event.clientY) / imageBox.height;
      crop = handle === "move" ? moveCrop(start, dx, dy) : resizeCrop(start, handle, dx, dy, aspect());
      draw();
    };
    const onEnd = () => {
      box.removeEventListener("pointermove", onMove);
      box.removeEventListener("pointerup", onEnd);
      box.removeEventListener("pointercancel", onEnd);
    };
    box.addEventListener("pointermove", onMove);
    box.addEventListener("pointerup", onEnd);
    box.addEventListener("pointercancel", onEnd);
  });

  const ratios = el("div", "crop-ratios");
  const ratioButtons = CROP_RATIOS.map(([key, value]) => {
    const button = el("button", "crop-ratio", t(key));
    button.type = "button";
    button.addEventListener("click", () => {
      ratio = value;
      crop = applyAspect(crop, aspect());
      ratioButtons.forEach((b) => b.setAttribute("aria-pressed", String(b === button)));
      draw();
    });
    button.setAttribute("aria-pressed", String(value === null));
    ratios.append(button);
    return button;
  });

  const apply = async () => {
    const next = { ...crops };
    if (isFullCrop(crop)) delete next[shotStep.id];
    else next[shotStep.id] = roundedCrop(crop);
    dialog.close();
    await chrome.storage.local.set({ crops: next });
  };
  const footer = el("div", "crop-footer");
  const reset = el("button", "crop-button", t("cropReset"));
  reset.type = "button";
  reset.addEventListener("click", () => {
    crop = { ...FULL_CROP };
    ratio = null;
    ratioButtons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === 0)));
    draw();
  });
  const cancel = el("button", "crop-button", t("cropCancel"));
  cancel.type = "button";
  cancel.addEventListener("click", () => dialog.close());
  const ok = el("button", "crop-button primary", t("cropApply"));
  ok.type = "button";
  ok.addEventListener("click", apply);
  footer.append(ratios, reset, cancel, ok);
  dialog.append(footer);

  // Enter — применить (кроме нажатия на кнопку), Esc закрывает окно сам
  dialog.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && event.target.tagName !== "BUTTON") {
      event.preventDefault();
      apply();
    }
  });
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  ok.focus();
  draw();
}

// Размытая произвольная область; в режиме выделения у неё есть кнопка удаления.
// stepId и index — где область хранится (у шага, на скриншоте которого её выделили)
function renderArea(stepId, area, index, interactive) {
  const mask = el("div", "shot-mask area");
  Object.assign(mask.style, fractionStyle(area));
  if (interactive && mode === "areas") {
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
function enableAreaDrawing(wrap, stage, img, stepId) {
  wrap.classList.add("drawing");
  wrap.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".area-remove")) return;
    event.preventDefault();
    const box = img.getBoundingClientRect();
    const toPoint = (e) => ({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height });
    const start = toPoint(event);
    const draft = el("div", "area-draft");
    stage.append(draft);
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

async function saveJoined(stepId) {
  await chrome.storage.local.set({ joinedSteps: toggleJoin(joinedSteps, stepId) });
}

function smallButton(text, onClick) {
  const button = el("button", "small-button", text);
  button.type = "button";
  button.addEventListener("click", onClick);
  return button;
}

// Данные шагов для анализа в спайке (SQ-5): откуда взята подпись, что записано
function renderDebug(steps) {
  const debug = el("details", "step-debug");
  debug.append(el("summary", null, t("viewerDebugToggle")));
  for (const step of steps) {
    const meta = [step.type, step.label ? `«${step.label}»` : ""];
    if (step.value !== null && step.value !== undefined) meta.push(`= «${step.value}»`);
    meta.push(t("viewerLabelSource", [step.labelSource]));
    if (step.mergedFrom?.length) meta.push(`+${step.mergedFrom.length}`);
    if (step.element?.path) meta.push(step.element.path);
    if (step.screenshotSource) meta.push(t("viewerShotSource", [step.screenshotSource]));
    meta.push(step.page?.url || "");
    debug.append(el("p", "step-meta", meta.filter(Boolean).join(" · ")));
  }
  return debug;
}

// Слои общего скриншота группы — одинаковые на экране и в выгруженном документе:
// рамки шагов с номерами, области размытия со всех шагов группы и кадр
function groupLayers(group) {
  const multi = group.items.length > 1;
  const frames = group.items
    .map(({ step, number }) => ({ rect: rectOnShot(step, group.shotStep), number: multi ? number : null }))
    .filter((frame) => frame.rect);
  // Области, скрытые на скриншотах любых шагов группы, должны быть скрыты и на общем скриншоте
  const areas = group.items.flatMap(({ step }) => areasOf(maskedAreas, step.id)
    .map((area, index) => ({ stepId: step.id, index, area: areaOnShot(area, step, group.shotStep) }))
    .filter(({ area }) => area));
  return { multi, frames, areas, crop: crops[group.shotStep.id] || null };
}

// Карточка группы шагов: один шаг или несколько шагов под общим скриншотом последнего шага
function renderGroup(group, isFirstGroup, shotOf) {
  const { multi, frames, areas, crop } = groupLayers(group);
  const card = el("li", multi ? "step group" : "step");
  // Значения отмеченных полей не показываем нигде, включая технические подробности
  const shown = group.items.map(({ step, number }) => ({ raw: step, step: maskStep(step, masks), number }));

  if (!isFirstGroup) {
    const join = smallButton(t("viewerJoinPrevious"), () => saveJoined(group.items[0].step.id));
    join.classList.add("join-button");
    card.append(join);
  }

  if (!multi) {
    const head = el("p", "step-head");
    head.append(el("span", "step-number", t("viewerStepNumber", [String(shown[0].number)])));
    head.append(el("span", "step-text", describeStep(shown[0].step).text));
    card.append(head);
  } else {
    const first = shown[0].number;
    const last = shown[shown.length - 1].number;
    card.append(el("p", "step-head step-number", t("viewerGroupNumbers", [String(first), String(last)])));
    const list = el("ol", "group-items");
    shown.forEach(({ raw, step, number }, index) => {
      const item = el("li", "group-item");
      item.append(el("span", "group-item-number", String(number)));
      item.append(el("span", "step-text", describeStep(step).text));
      const rect = rectOnShot(raw, group.shotStep);
      if (!rect) item.append(el("span", "not-on-shot", t("viewerNotOnShot")));
      else if (!rectInCrop(rect, group.shotStep.viewport, crop)) item.append(el("span", "not-on-shot", t("viewerFrameOutsideCrop")));
      if (index > 0) item.append(smallButton(t("viewerSplit"), () => saveJoined(raw.id)));
      list.append(item);
    });
    card.append(list);
  }

  const dataUrl = shotOf(group.shotStep);
  if (!multi && frames.length && !rectInCrop(frames[0].rect, group.shotStep.viewport, crop)) {
    card.append(el("p", "not-on-shot", t("viewerFrameOutsideCrop")));
  }
  card.append(renderShot(group.shotStep, dataUrl, { frames, areas, crop }));
  if (dataUrl) {
    const cropButton = smallButton(t(isFullCrop(crop) ? "viewerCrop" : "viewerCropChange"),
      () => openCropEditor(group.shotStep, dataUrl, frames, areas));
    cropButton.classList.add("crop-open");
    card.append(cropButton);
  }
  card.append(renderDebug(shown.map(({ step }) => step)));
  return card;
}

// Отсеянный шаг: без номера, с причиной отсева
function renderDroppedStep(rawStep, reason, dataUrl) {
  const step = maskStep(rawStep, masks);
  const item = el("li", "step dropped");
  const head = el("p", "step-head");
  head.append(el("span", "step-text", describeStep(step).text));
  item.append(head);
  item.append(el("p", "step-reason", t(reason)));
  item.append(renderShot(step, dataUrl));
  item.append(renderDebug([step]));
  return item;
}

// Заголовок раздела: номер, название (можно исправить на месте) и удаление.
// Удалённый раздел исчезает, его шаги переходят в предыдущий раздел
function renderSectionHead(section) {
  const head = el("li", "section-head");
  head.append(el("span", "section-number", section.number === null ? "—" : String(section.number)));
  const title = el("input", "section-title");
  title.type = "text";
  title.maxLength = SECTION_TITLE_MAX;
  title.value = section.title;
  title.setAttribute("aria-label", t("viewerSectionTitleLabel"));
  title.addEventListener("change", async () => {
    const { sections: stored = [] } = await chrome.storage.local.get("sections");
    const next = renameSection(stored, section.id, title.value);
    if (next === stored) title.value = section.title;
    else await chrome.storage.local.set({ sections: next });
  });
  title.addEventListener("keydown", (e) => {
    if (e.key === "Enter") title.blur();
  });
  head.append(title);
  head.append(smallButton(t("viewerSectionDelete"), async () => {
    const { sections: stored = [] } = await chrome.storage.local.get("sections");
    await chrome.storage.local.set({ sections: removeSection(stored, section.id) });
  }));
  if (section.number === null) head.append(el("p", "section-empty", t("viewerSectionEmpty")));
  return head;
}

// Сводка: SQ-5 — у скольких шагов описание построено с подписью элемента; SQ-2 — сколько отсеяно;
// FR-7 — сколько скриншотов останется в инструкции после объединения шагов
function renderStats(steps, dropped, groups) {
  const withLabel = steps.filter((step) => describeStep(step).usesLabel).length;
  statsEl.textContent = [
    t("viewerLabelStats", [String(withLabel), String(steps.length)]),
    t("viewerDroppedStats", [String(dropped.length)]),
    t("viewerShotCount", [String(countShots(groups))]),
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
  const stored = await chrome.storage.local.get(["steps", "maskedFields", "maskedAreas", "joinedSteps", "crops", "sections"]);
  const { steps: rawSteps = [], maskedFields = [] } = stored;
  masks = maskedFields;
  maskedAreas = stored.maskedAreas || {};
  joinedSteps = stored.joinedSteps || [];
  crops = stored.crops || {};
  sections = stored.sections || [];
  renderMaskToolbar();
  const { steps, dropped } = normalizeSteps(rawSteps);
  const shotKeys = rawSteps.map((step) => SHOT_PREFIX + step.id);
  const shots = shotKeys.length ? await chrome.storage.local.get(shotKeys) : {};
  const shotOf = (step) => shots[SHOT_PREFIX + step.id];

  emptyEl.hidden = rawSteps.length > 0;
  const parts = buildParts(steps, joinedSteps, sections);
  const groups = parts.flatMap((part) => part.groups);
  current = { parts, groups, shotOf, rawSteps };
  renderStats(steps, dropped, groups);
  // Первая группа раздела не объединяется с прошлым разделом: у неё нет кнопки «Объединить с предыдущим»
  stepsEl.replaceChildren(...parts.flatMap((part) => [
    ...(part.section ? [renderSectionHead(part.section)] : []),
    ...part.groups.map((group, i) => renderGroup(group, i === 0, shotOf)),
  ]));

  // Раздел сохраняет состояние «раскрыт / свёрнут» при обновлении во время записи
  droppedEl.hidden = dropped.length === 0;
  droppedListEl.replaceChildren(...dropped.map(({ step, reason }) => renderDroppedStep(step, reason, shotOf(step))));
  document.dispatchEvent(new Event("viewer-rendered"));
}

render();

// Страница обновляется сама, пока идёт запись
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && ["steps", "maskedFields", "maskedAreas", "joinedSteps", "crops", "sections"].some((key) => key in changes)) render();
});
