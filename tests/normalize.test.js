// Тест обработки шагов (SQ-1, SQ-2): склеивание выбора в списках и отсев шума.
// Запуск из корня репозитория: osascript -l JavaScript tests/normalize.test.js
// Шаги повторяют то, что записывает recorder.js на test-pages/dropdowns.html и forms.html.

ObjC.import("Foundation");

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) throw new Error("Не удалось прочитать " + path);
  return text.js;
}

eval(readFile("extension/shared/normalize.js"));

let clock = 0;
let counter = 0;
// Шаг с разумными значениями по умолчанию; after — пауза перед шагом, мс
function step(type, fields = {}, after = 2000) {
  clock += after;
  counter += 1;
  return {
    id: "s" + counter,
    type,
    label: "",
    labelSource: "none",
    fieldLabel: "",
    fieldLabelSource: "none",
    value: null,
    timestamp: clock,
    ...fields,
    element: { tag: "div", role: null, path: "#el" + counter, ariaHaspopup: null, ariaExpanded: null, ariaControls: null, container: null, ...fields.element },
  };
}

const failures = [];
let checks = 0;
function expect(name, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n  ожидалось: ${e}\n  получено:  ${a}`);
}
// Краткий вид результата: тип, подпись, значение
const brief = (steps) => steps.map((s) => [s.type, s.label, s.value]);
const reasons = (dropped) => dropped.map((d) => [d.step.id, d.reason]);

// --- 1. mat-select: открыть список + выбрать вариант → один шаг «В списке «Тип происшествия» выберите «ДТП»»
{
  const trigger = step("click", {
    label: "— выберите —", labelSource: "text", fieldLabel: "Тип происшествия", fieldLabelSource: "aria-labelledby",
    element: { tag: "mat-select", role: "combobox", path: "#sel-type", ariaHaspopup: "listbox", ariaExpanded: "false" },
  });
  const option = step("click", {
    label: "ДТП", labelSource: "text",
    element: { tag: "mat-option", role: "option", container: { role: "listbox", id: "sel-type-panel" } },
  });
  const { steps, dropped } = normalizeSteps([trigger, option]);
  expect("mat-select: один шаг выбора", brief(steps), [["select", "Тип происшествия", "ДТП"]]);
  expect("mat-select: скриншот и рамка от варианта", steps[0].id, option.id);
  expect("mat-select: открытие отсеяно", reasons(dropped), [[trigger.id, "noiseMergedIntoChoice"]]);
}

// --- 2. mat-autocomplete: ввод «ул» + выбор подсказки → один шаг
{
  const typed = step("input", {
    label: "Адрес происшествия", labelSource: "label", fieldLabel: "Адрес происшествия", fieldLabelSource: "label", value: "ул",
    element: { tag: "input", inputType: "text", role: "combobox", path: "#ac-address", ariaHaspopup: "listbox", ariaExpanded: "true" },
  });
  const option = step("click", {
    label: "ул. Тестовая, 15", labelSource: "text",
    element: { tag: "mat-option", role: "option", container: { role: "listbox", id: "ac-address-panel" } },
  });
  const { steps, dropped } = normalizeSteps([typed, option]);
  expect("autocomplete: один шаг выбора", brief(steps), [["select", "Адрес происшествия", "ул. Тестовая, 15"]]);
  expect("autocomplete: текст поиска отсеян", reasons(dropped), [[typed.id, "noiseSearchText"]]);
}

// --- 3. mat-menu: «Действия» + пункт меню → «В меню «Действия» выберите «Передать в службу»»
{
  const trigger = step("click", {
    label: "Действия", labelSource: "text",
    element: { tag: "button", path: "#menu-trigger", ariaHaspopup: "menu", ariaExpanded: "false" },
  });
  const item = step("click", {
    label: "Передать в службу", labelSource: "text",
    element: { tag: "button", role: "menuitem", container: { role: "menu", id: "actions-menu" } },
  });
  const { steps } = normalizeSteps([trigger, item]);
  expect("mat-menu: один шаг меню", brief(steps), [["menu", "Действия", "Передать в службу"]]);
}

// --- 4. Список без названия поля: вариант остаётся отдельным шагом, открытие отсеяно
{
  const trigger = step("click", {
    label: "— выберите —", labelSource: "text",
    element: { tag: "div", role: "combobox", ariaHaspopup: "listbox", ariaExpanded: "false" },
  });
  const option = step("click", { label: "Пожар", labelSource: "text", element: { role: "option" } });
  const { steps, dropped } = normalizeSteps([trigger, option]);
  expect("без названия: остаётся выбор варианта", brief(steps), [["click", "Пожар", null]]);
  expect("без названия: открытие отсеяно", reasons(dropped), [[trigger.id, "noiseMergedIntoChoice"]]);
}

// --- 5. Самописный список без ARIA: не распознаётся, остаётся двумя кликами (ожидаемое ограничение)
{
  const trigger = step("click", { label: "— выберите —", labelSource: "text", fieldLabel: "Служба реагирования", fieldLabelSource: "nearby-label" });
  const option = step("click", { label: "Полиция", labelSource: "text" });
  const { steps, dropped } = normalizeSteps([trigger, option]);
  expect("без ARIA: два клика", brief(steps), [["click", "— выберите —", null], ["click", "Полиция", null]]);
  expect("без ARIA: ничего не отсеяно", dropped.length, 0);
}

// --- 6. Список открыт и закрыт без выбора → оба клика отсеяны
{
  const open = step("click", { fieldLabel: "Тип происшествия", element: { role: "combobox", path: "#sel", ariaHaspopup: "listbox", ariaExpanded: "false" } });
  const close = step("click", { fieldLabel: "Тип происшествия", element: { role: "combobox", path: "#sel", ariaHaspopup: "listbox", ariaExpanded: "true" } });
  const save = step("click", { label: "Сохранить", labelSource: "text", element: { tag: "button" } });
  const { steps, dropped } = normalizeSteps([open, close, save]);
  expect("открыт без выбора: остаётся только «Сохранить»", brief(steps), [["click", "Сохранить", null]]);
  expect("открыт без выбора: причины", reasons(dropped), [[open.id, "noiseListOpenedNoChoice"], [close.id, "noiseListClosed"]]);
}

// --- 7. Двойной клик по кнопке → один шаг; клик через 2 секунды — отдельный шаг
{
  const first = step("click", { label: "Сохранить", labelSource: "text", element: { tag: "button", path: "#save" } });
  const quick = step("click", { label: "Сохранить", labelSource: "text", element: { tag: "button", path: "#save" } }, 300);
  const later = step("click", { label: "Сохранить", labelSource: "text", element: { tag: "button", path: "#save" } }, 2000);
  const { steps, dropped } = normalizeSteps([first, quick, later]);
  expect("двойной клик: два шага из трёх", steps.map((s) => s.id), [first.id, later.id]);
  expect("двойной клик: причина", reasons(dropped), [[quick.id, "noiseRepeatedClick"]]);
}

// --- 8. Ввод в одно поле дважды подряд → итоговое значение
{
  const a = step("input", { label: "Фамилия", labelSource: "label", value: "Тест", element: { tag: "input", path: "#last-name" } });
  const b = step("input", { label: "Фамилия", labelSource: "label", value: "Тестов", element: { tag: "input", path: "#last-name" } });
  const { steps, dropped } = normalizeSteps([a, b]);
  expect("повторный ввод: итоговое значение", brief(steps), [["input", "Фамилия", "Тестов"]]);
  expect("повторный ввод: причина", reasons(dropped), [[a.id, "noiseRepeatedInput"]]);
}

// --- 9. Поиск с Enter, затем уточнение в том же поле → оба шага остаются
{
  const a = step("input", { label: "Поиск", labelSource: "label", value: "пожар", pressedEnter: true, element: { tag: "input", path: "#q" } });
  const b = step("input", { label: "Поиск", labelSource: "label", value: "пожар ул. Тестовая", element: { tag: "input", path: "#q" } });
  const { steps } = normalizeSteps([a, b]);
  expect("ввод с Enter не поглощается", steps.length, 2);
}

// --- 10. Ввод в другое поле перед автодополнением не поглощается
{
  const other = step("input", { label: "Фамилия", labelSource: "label", value: "Тестов", element: { tag: "input", path: "#last-name" } });
  const typed = step("input", {
    fieldLabel: "Адрес происшествия", fieldLabelSource: "label", value: "ул",
    element: { tag: "input", role: "combobox", path: "#ac", ariaHaspopup: "listbox" },
  });
  const option = step("click", { label: "ул. Тестовая, 1", labelSource: "text", element: { role: "option" } });
  const { steps } = normalizeSteps([other, typed, option]);
  expect("чужой ввод сохранён", brief(steps), [["input", "Фамилия", "Тестов"], ["select", "Адрес происшествия", "ул. Тестовая, 1"]]);
}

// --- 11. Вариант выбран слишком поздно (больше 30 с) → не склеивается
{
  const trigger = step("click", { fieldLabel: "Тип происшествия", element: { role: "combobox", ariaHaspopup: "listbox", ariaExpanded: "false" } });
  const option = step("click", { label: "Пожар", labelSource: "text", element: { role: "option" } }, 31000);
  const { steps } = normalizeSteps([trigger, option]);
  expect("поздний выбор: открытие отсеяно, выбор отдельно", brief(steps), [["click", "Пожар", null]]);
}

// --- 12. Шаги старых записей без element.path не склеиваются как повторные
{
  const a = { id: "old1", type: "input", label: "Фамилия", value: "А", timestamp: 1, element: { tag: "input" } };
  const b = { id: "old2", type: "input", label: "Фамилия", value: "Б", timestamp: 2, element: { tag: "input" } };
  expect("старые шаги без path", normalizeSteps([a, b]).steps.length, 2);
}

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
