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

// --- Произвольные области с ранних шагов группы на общем скриншоте
const area = { x: 0.1, y: 0.5, width: 0.2, height: 0.1 };
const shot = step("z", { scroll: { x: 0, y: 160 } });
expect("область своего шага без изменений", areaOnShot(area, shot, shot), area);
expect("без прокрутки — на том же месте", areaOnShot(area, step("p", { scroll: { x: 0, y: 160 } }), shot), area);
// 0.5 * 800 = 400 px; страница прокручена на 160 px дальше → 240 px = 0.3
const moved = areaOnShot(area, step("p", { scroll: { x: 0, y: 0 } }), shot);
expect("поправка на прокрутку", [moved.x, Math.round(moved.y * 1000) / 1000, moved.width, Math.round(moved.height * 1000) / 1000], [0.1, 0.3, 0.2, 0.1]);
const cut = areaOnShot({ x: 0.1, y: 0.1, width: 0.2, height: 0.2 }, step("p", { scroll: { x: 0, y: 0 } }), shot);
expect("частично за верхним краем → обрезана", [Math.round(cut.y * 1000) / 1000, Math.round(cut.height * 1000) / 1000], [0, 0.1]);
expect("целиком за краем → не показывается", areaOnShot({ x: 0.1, y: 0, width: 0.2, height: 0.1 }, step("p", { scroll: { x: 0, y: 0 } }), shot), null);
expect("другая страница → без поправки на прокрутку",
  areaOnShot(area, step("p", { page: { url: FORM + "#/card/2" }, scroll: { x: 0, y: 0 } }), shot), area);
expect("старая запись без размера окна → как есть", areaOnShot(area, step("p", { viewport: undefined }), shot), area);

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
