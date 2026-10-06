// Тест маскирования полей (FR-6, SQ-6).
// Запуск из корня репозитория: osascript -l JavaScript tests/mask.test.js

ObjC.import("Foundation");

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) throw new Error("Не удалось прочитать " + path);
  return text.js;
}

eval(readFile("extension/shared/mask.js"));
eval(readFile("extension/shared/normalize.js"));

const failures = [];
let checks = 0;
function expect(name, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n  ожидалось: ${e}\n  получено:  ${a}`);
}

const FORM = "http://127.0.0.1:8000/forms.html";
const phone = { path: "#phone", fieldLabel: "Телефон заявителя", rect: { x: 10, y: 100, width: 200, height: 30 } };
const lastName = { path: "#last-name", fieldLabel: "Фамилия", rect: { x: 10, y: 60, width: 200, height: 30 } };

function step(fields, extra = {}) {
  return { type: "click", value: null, page: { url: FORM }, element: { path: "#save" }, fields, ...extra };
}

// --- Отметка и снятие
let masks = toggleMask([], phone, FORM + "?id=7#top");
expect("отметка сохраняет адрес, название и страницу без параметров", masks,
  [{ path: "#phone", fieldLabel: "Телефон заявителя", pageKey: FORM }]);
expect("повторная отметка снимает", toggleMask(masks, phone, FORM), []);

// --- Прямоугольники на скриншотах
expect("закрывается только отмеченное поле", maskedRects(step([lastName, phone]), masks), [phone.rect]);
expect("поле на другом месте экрана (после прокрутки)",
  maskedRects(step([{ ...phone, rect: { x: 10, y: 5, width: 200, height: 30 } }]), masks), [{ x: 10, y: 5, width: 200, height: 30 }]);
expect("без отметок ничего не закрывается", maskedRects(step([phone]), []), []);
expect("шаг старой записи без полей", maskedRects({ page: { url: FORM } }, masks), []);

// --- Поле узнаётся по названию на той же странице, даже если адрес другой (Angular: mat-input-0 → mat-input-3)
const sameLabelOtherPath = { path: "#mat-input-3", fieldLabel: "Телефон заявителя", rect: phone.rect };
expect("то же название, та же страница → закрыто", maskedRects(step([sameLabelOtherPath]), masks), [phone.rect]);
expect("то же название, другая страница → не закрыто",
  maskedRects(step([sameLabelOtherPath], { page: { url: "http://127.0.0.1:8000/other.html" } }), masks), []);
expect("тот же адрес на другой странице → закрыто (с запасом)",
  maskedRects(step([phone], { page: { url: "http://127.0.0.1:8000/other.html" } }), masks), [phone.rect]);

// --- Поле частично под раскрытым списком: скрываются только видимые части
const partlyCovered = { ...phone, visibleRects: [{ x: 10, y: 100, width: 50, height: 30 }] };
expect("частично под списком → только видимая часть", maskedRects(step([partlyCovered]), masks), [{ x: 10, y: 100, width: 50, height: 30 }]);
expect("целиком под списком → ничего не скрывается поверх списка", maskedRects(step([{ ...phone, visibleRects: [] }]), masks), []);

// --- Значения в описаниях
const typed = { type: "input", value: "+7 900 000-00-00", fieldLabel: "Телефон заявителя", page: { url: FORM }, element: { path: "#phone" } };
expect("значение отмеченного поля заменяется", maskStep(typed, masks).value, "***");
expect("значение другого поля не меняется", maskStep({ ...typed, element: { path: "#last-name" }, fieldLabel: "Фамилия" }, masks).value, "+7 900 000-00-00");
expect("клик без значения не меняется", maskStep(step([phone]), masks), step([phone]));
expect("исходный шаг не изменён", typed.value, "+7 900 000-00-00");

// --- Склеенный выбор в списке маскируется по полю списка, а не по варианту
const trigger = {
  id: "t", type: "click", timestamp: 1000, fieldLabel: "Адрес происшествия", page: { url: FORM },
  element: { role: "combobox", path: "#ac-address", ariaHaspopup: "listbox", ariaExpanded: "false" },
};
const option = {
  id: "o", type: "click", timestamp: 2000, label: "ул. Тестовая, 15", labelSource: "text", page: { url: FORM },
  element: { role: "option", path: "#ac-address-panel-item-1" },
};
const merged = normalizeSteps([trigger, option]).steps[0];
const addressMasks = toggleMask([], { path: "#ac-address", fieldLabel: "Адрес происшествия" }, FORM);
expect("выбор в отмеченном списке скрыт", maskStep(merged, addressMasks).value, "***");

// --- Полосы видимых частей склеиваются
expect("полосы друг под другом → один прямоугольник", mergeRects([
  { x: 10, y: 100, width: 50, height: 5 }, { x: 10, y: 105, width: 50, height: 5 }, { x: 11, y: 110, width: 49, height: 5 },
]), [{ x: 10, y: 100, width: 50, height: 15 }]);
expect("полосы разной ширины не склеиваются", mergeRects([
  { x: 10, y: 100, width: 50, height: 5 }, { x: 10, y: 105, width: 120, height: 5 },
]).length, 2);

// --- Произвольные области
expect("область по двум углам в любом порядке", areaFromPoints({ x: 0.6, y: 0.5 }, { x: 0.2, y: 0.1 }),
  { x: 0.2, y: 0.1, width: 0.4, height: 0.4 });
expect("область обрезается краями снимка", areaFromPoints({ x: -0.2, y: 0.9 }, { x: 0.3, y: 1.4 }),
  { x: 0, y: 0.9, width: 0.3, height: 0.1 });
expect("случайный щелчок не создаёт область", areaFromPoints({ x: 0.5, y: 0.5 }, { x: 0.501, y: 0.6 }), null);

let areas = addArea({}, "s1", { x: 0.1, y: 0.1, width: 0.2, height: 0.2 });
areas = addArea(areas, "s1", { x: 0.5, y: 0.5, width: 0.1, height: 0.1 });
areas = addArea(areas, "s2", { x: 0, y: 0, width: 1, height: 0.1 });
expect("области привязаны к своему скриншоту", areasOf(areas, "s1").length, 2);
expect("на других скриншотах областей нет", areasOf(areas, "s3"), []);
expect("подсчёт областей", countAreas(areas), 3);
areas = removeArea(areas, "s1", 0);
expect("удаление нужной области", areasOf(areas, "s1"), [{ x: 0.5, y: 0.5, width: 0.1, height: 0.1 }]);
expect("последняя область удаляется вместе с ключом", Object.keys(removeArea(areas, "s2", 0)), ["s1"]);

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
