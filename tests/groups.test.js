// Тест объединения шагов под одним скриншотом (FR-7).
// Запуск из корня репозитория: osascript -l JavaScript tests/groups.test.js

ObjC.import("Foundation");

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) throw new Error("Не удалось прочитать " + path);
  return text.js;
}

eval(readFile("extension/shared/groups.js"));

const failures = [];
let checks = 0;
function expect(name, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n  ожидалось: ${e}\n  получено:  ${a}`);
}

const FORM = "http://127.0.0.1:8000/forms.html";
const VIEWPORT = { width: 1200, height: 800 };
const step = (id, fields = {}) => ({
  id, page: { url: FORM }, viewport: VIEWPORT, scroll: { x: 0, y: 0 },
  rect: { x: 100, y: 100, width: 200, height: 30 }, ...fields,
});

const steps = [step("a"), step("b"), step("c"), step("d"), step("e")];
const shape = (groups) => groups.map((g) => g.items.map((i) => `${i.step.id}${i.number}`).join(" "));

// --- Группы
expect("без объединения каждый шаг отдельно", shape(buildGroups(steps, [])), ["a1", "b2", "c3", "d4", "e5"]);
expect("b, c, d объединены с предыдущими → группа из a–d", shape(buildGroups(steps, ["b", "c", "d"])), ["a1 b2 c3 d4", "e5"]);
expect("две группы, нумерация сквозная", shape(buildGroups(steps, ["b", "d", "e"])), ["a1 b2", "c3 d4 e5"]);
expect("скриншот группы — последний шаг", buildGroups(steps, ["b", "c"]).map((g) => g.shotStep.id), ["c", "d", "e"]);
expect("отметка у первого шага ничего не меняет", shape(buildGroups(steps, ["a"])), ["a1", "b2", "c3", "d4", "e5"]);
expect("отметка исчезнувшего шага ничего не меняет", shape(buildGroups(steps, ["x"])).length, 5);
expect("число скриншотов", countShots(buildGroups(steps, ["b", "c", "d"])), 2);

// --- Объединение и разделение
expect("объединить", toggleJoin(["b"], "c"), ["b", "c"]);
expect("отделить", toggleJoin(["b", "c"], "b"), ["c"]);

// --- Рамки на скриншоте группы
const last = step("z", { scroll: { x: 0, y: 300 } });
expect("рамка последнего шага без изменений", rectOnShot(last, last), last.rect);
expect("ранний шаг: поправка на прокрутку", rectOnShot(step("p", { scroll: { x: 0, y: 200 } }), last),
  { x: 100, y: 0, width: 200, height: 30 });
expect("ранний шаг ушёл за верхний край", rectOnShot(step("p", { scroll: { x: 0, y: 0 } }), last), null);
expect("другая страница → рамки нет", rectOnShot(step("p", { page: { url: FORM + "#/card/2" }, scroll: last.scroll }), last), null);
expect("другой размер окна → рамки нет",
  rectOnShot(step("p", { viewport: { width: 1000, height: 800 }, scroll: last.scroll }), last), null);
expect("старые записи без прокрутки: без поправки",
  rectOnShot(step("p", { scroll: undefined }), step("q", { scroll: undefined })), { x: 100, y: 100, width: 200, height: 30 });
expect("шаг без рамки", rectOnShot(step("p", { rect: undefined }), last), null);

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
