// Ручное маскирование полей (FR-6, SQ-6). Автор отмечает поле на любом скриншоте записи,
// и оно размывается на всех скриншотах, а его значение в описаниях заменяется на «***».
//
// Отметка: { path, fieldLabel, pageKey }. Поле считается тем же, если совпал адрес элемента
// или название поля на той же странице. Это с запасом: адреса полей в Angular могут меняться
// между загрузками страницы, а лишнее скрытие безопаснее пропущенных данных.

const MASKED_VALUE = "***";

// Страница без параметров запроса и якоря: одна и та же форма с разными параметрами — одна страница
function pageKey(url) {
  return (url || "").split(/[?#]/)[0];
}

function fieldMatchesMask(field, mask, fieldPageKey) {
  if (field.path && field.path === mask.path) return true;
  return Boolean(mask.fieldLabel) && field.fieldLabel === mask.fieldLabel && fieldPageKey === mask.pageKey;
}

function isFieldMasked(field, masks, fieldPageKey) {
  return masks.some((mask) => fieldMatchesMask(field, mask, fieldPageKey));
}

// Видимые части поля на скриншоте. Если поле частично закрыто раскрытым списком или меню,
// recorder.js сохраняет только незакрытые части (visibleRects; пустой массив — поле закрыто целиком).
function visibleFieldRects(field) {
  return field.visibleRects ? mergeRects(field.visibleRects) : [field.rect];
}

// Склеивает полосы видимых частей поля (по строкам сетки) в цельные прямоугольники,
// если они стоят друг под другом и совпадают по ширине (с допуском на округление в 1 px)
function mergeRects(rects) {
  const sorted = [...rects].sort((a, b) => a.x - b.x || a.y - b.y);
  const merged = [];
  for (const rect of sorted) {
    const last = merged.find((m) =>
      Math.abs(m.x - rect.x) <= 1 && Math.abs(m.width - rect.width) <= 1 && Math.abs(m.y + m.height - rect.y) <= 1);
    if (last) last.height = rect.y + rect.height - last.y;
    else merged.push({ ...rect });
  }
  return merged;
}

// --- Произвольные области (FR-6): прямоугольник на одном скриншоте, в долях размера снимка (0..1).
// Хранятся в chrome.storage.local, ключ "maskedAreas": { [id шага]: [{ x, y, width, height }] }.

// Слишком маленькая область — скорее всего, случайный щелчок
const MIN_AREA_FRACTION = 0.005;

const clamp01 = (value) => Math.min(1, Math.max(0, value));
const round4 = (value) => Math.round(value * 10000) / 10000;

// Область по двум углам, выделенным мышью; null — слишком маленькая
function areaFromPoints(a, b) {
  const x1 = clamp01(Math.min(a.x, b.x));
  const y1 = clamp01(Math.min(a.y, b.y));
  const x2 = clamp01(Math.max(a.x, b.x));
  const y2 = clamp01(Math.max(a.y, b.y));
  if (x2 - x1 < MIN_AREA_FRACTION || y2 - y1 < MIN_AREA_FRACTION) return null;
  return { x: round4(x1), y: round4(y1), width: round4(x2 - x1), height: round4(y2 - y1) };
}

function areasOf(maskedAreas, stepId) {
  return maskedAreas[stepId] || [];
}

function addArea(maskedAreas, stepId, area) {
  return { ...maskedAreas, [stepId]: [...areasOf(maskedAreas, stepId), area] };
}

function removeArea(maskedAreas, stepId, index) {
  const rest = areasOf(maskedAreas, stepId).filter((_, i) => i !== index);
  const next = { ...maskedAreas, [stepId]: rest };
  if (!rest.length) delete next[stepId];
  return next;
}

function countAreas(maskedAreas) {
  return Object.values(maskedAreas).reduce((sum, areas) => sum + areas.length, 0);
}

// Прямоугольники полей, которые нужно скрыть на скриншоте шага
function maskedRects(step, masks) {
  if (!masks.length || !step.fields) return [];
  const key = pageKey(step.page?.url);
  return step.fields.filter((field) => isFieldMasked(field, masks, key)).flatMap(visibleFieldRects);
}

// Поле, в которое шаг вводит значение. У склеенного выбора в списке это поле списка, а не вариант.
function stepField(step) {
  return { path: step.fieldPath || step.element?.path, fieldLabel: step.fieldLabel };
}

// Шаг с замаскированным значением для описания
function maskStep(step, masks) {
  const hasValue = step.value !== null && step.value !== undefined && typeof step.value !== "boolean";
  if (!hasValue || !isFieldMasked(stepField(step), masks, pageKey(step.page?.url))) return step;
  return { ...step, value: MASKED_VALUE, valueMasked: true };
}

// Отметить поле или снять отметку. Снятие убирает все отметки, под которые подходит поле.
function toggleMask(masks, field, stepPageUrl) {
  const key = pageKey(stepPageUrl);
  if (isFieldMasked(field, masks, key)) {
    return masks.filter((mask) => !fieldMatchesMask(field, mask, key));
  }
  return [...masks, { path: field.path, fieldLabel: field.fieldLabel || "", pageKey: key }];
}
