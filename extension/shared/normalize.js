// Обработка записанных шагов перед показом (SQ-1, SQ-2): склеивание выбора в выпадающих списках
// и отсев шумных шагов. Записанные шаги не меняются: обработка повторяется при каждом показе,
// поэтому правила можно менять, и старые записи тоже пересчитаются.
//
// Результат: { steps, dropped }. steps — шаги для инструкции; dropped — отсеянные шаги с причиной
// (ключ строки в messages.json), чтобы автор и спайк могли проверить, не выброшено ли лишнее.

// Выбор варианта считается относящимся к списку, если прошло не больше этого времени
const DROPDOWN_WINDOW_MS = 30000;
// Повторный клик по тому же элементу быстрее этого срока считаем случайным
const REPEAT_CLICK_MS = 1000;

// Элемент, раскрывающий список или меню: mat-select, mat-autocomplete, кнопка mat-menu и т.п.
function isListTrigger(step) {
  const element = step.element || {};
  return element.role === "combobox" || ["listbox", "menu", "true"].includes(element.ariaHaspopup);
}

// Вариант списка или пункт меню
function isListOption(step) {
  const element = step.element || {};
  return step.type === "click" &&
    (["option", "menuitem"].includes(element.role) || ["listbox", "menu"].includes(element.container?.role));
}

function isMenuOption(step) {
  return step.element?.role === "menuitem" || step.element?.container?.role === "menu";
}

function sameElement(a, b) {
  const pathA = a.element?.path;
  return Boolean(pathA) && pathA === b.element?.path;
}

function withinWindow(earlier, later, windowMs) {
  return later.timestamp - earlier.timestamp <= windowMs;
}

// Название списка для склеенного шага. У кнопки меню («Действия») название — её собственный текст;
// у списка собственный текст — это текущее значение, поэтому нужно название поля.
function listName(trigger, isMenu) {
  if (trigger.fieldLabel) return { text: trigger.fieldLabel, source: trigger.fieldLabelSource };
  if (isMenu && trigger.label && trigger.labelSource !== "name") return { text: trigger.label, source: trigger.labelSource };
  return null;
}

function normalizeSteps(rawSteps) {
  const steps = [];
  const dropped = [];
  const drop = (step, reason) => dropped.push({ step, reason });

  for (const step of rawSteps) {
    const prev = steps[steps.length - 1];

    // Двойной клик по тому же элементу
    if (prev && step.type === "click" && prev.type === "click" && sameElement(prev, step) &&
        withinWindow(prev, step, REPEAT_CLICK_MS)) {
      drop(step, "noiseRepeatedClick");
      continue;
    }

    // Несколько вводов подряд в одно поле: в инструкции нужно итоговое значение.
    // Ввод с Enter — отдельное действие (например, поиск), его не поглощаем.
    if (prev && step.type === "input" && prev.type === "input" && sameElement(prev, step) && !prev.pressedEnter) {
      steps.pop();
      drop(prev, "noiseRepeatedInput");
    }

    if (isListOption(step) && mergeListChoice(step, steps, drop)) continue;

    // Клик, закрывающий уже раскрытый список
    if (step.type === "click" && isListTrigger(step) && step.element?.ariaExpanded === "true") {
      drop(step, "noiseListClosed");
      continue;
    }

    steps.push(step);
  }

  // Списки, открытые без выбора варианта: в инструкции не нужны
  const result = steps.filter((step) => {
    const openedOnly = step.type === "click" && isListTrigger(step);
    if (openedOnly) drop(step, "noiseListOpenedNoChoice");
    return !openedOnly;
  });

  dropped.sort((a, b) => a.step.timestamp - b.step.timestamp);
  return { steps: result, dropped };
}

// Склеивает «открыть список (+ ввести текст для поиска) + выбрать вариант» в один шаг.
// Ищет в конце уже обработанных шагов элемент, раскрывший список. Возвращает true, если шаг обработан.
function mergeListChoice(option, steps, drop) {
  let index = steps.length - 1;
  // Ввод текста для поиска внутри списка (mat-autocomplete, список с поиском)
  while (index >= 0 && steps[index].type === "input" && withinWindow(steps[index], option, DROPDOWN_WINDOW_MS)) {
    index--;
  }

  let trigger = null;
  let start = index + 1;
  const candidate = steps[index];
  if (candidate && isListTrigger(candidate) && withinWindow(candidate, option, DROPDOWN_WINDOW_MS)) {
    trigger = candidate;
    start = index;
  } else {
    // В mat-autocomplete список раскрывает само поле ввода
    const typedTrigger = steps.slice(index + 1).find(isListTrigger);
    if (typedTrigger) {
      trigger = typedTrigger;
      start = steps.indexOf(typedTrigger);
    }
  }
  if (!trigger) return false;

  const absorbed = steps.splice(start);
  absorbed.forEach((step) => drop(step, step === trigger && step.type === "click" ? "noiseMergedIntoChoice" : "noiseSearchText"));

  const isMenu = isMenuOption(option);
  const name = listName(trigger, isMenu);
  if (!name) {
    // Название списка не нашлось: оставляем выбор варианта отдельным шагом («Выберите «ДТП»»)
    steps.push(option);
    return true;
  }

  steps.push({
    ...option,
    type: isMenu ? "menu" : "select",
    label: name.text,
    labelSource: name.source,
    value: option.label,
    mergedFrom: absorbed.map((step) => step.id),
  });
  return true;
}
