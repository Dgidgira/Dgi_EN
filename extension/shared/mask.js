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
  return field.visibleRects || [field.rect];
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
