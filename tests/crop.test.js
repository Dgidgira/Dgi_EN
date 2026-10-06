// Тест кадрирования скриншота (FR-7).
// Запуск из корня репозитория: osascript -l JavaScript tests/crop.test.js

ObjC.import("Foundation");

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) throw new Error("Не удалось прочитать " + path);
  return text.js;
}

eval(readFile("extension/shared/crop.js"));

const failures = [];
let checks = 0;
function expect(name, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n  ожидалось: ${e}\n  получено:  ${a}`);
}
const r = (crop) => crop && roundedCrop(crop);

const mid = { x: 0.2, y: 0.2, width: 0.4, height: 0.4 };

// --- Маркеры без пропорций
expect("правый нижний угол", r(resizeCrop(mid, "se", 0.1, 0.05)), { x: 0.2, y: 0.2, width: 0.5, height: 0.45 });
expect("левый верхний угол", r(resizeCrop(mid, "nw", -0.1, -0.1)), { x: 0.1, y: 0.1, width: 0.5, height: 0.5 });
expect("правая сторона меняет только ширину", r(resizeCrop(mid, "e", 0.2, 0.3)), { x: 0.2, y: 0.2, width: 0.6, height: 0.4 });
expect("верхняя сторона меняет только высоту", r(resizeCrop(mid, "n", 0.3, -0.1)), { x: 0.2, y: 0.1, width: 0.4, height: 0.5 });
expect("не выходит за край снимка", r(resizeCrop(mid, "se", 0.9, 0.9)), { x: 0.2, y: 0.2, width: 0.8, height: 0.8 });
expect("не меньше минимального размера", r(resizeCrop(mid, "e", -0.9, 0)), { x: 0.2, y: 0.2, width: 0.05, height: 0.4 });
expect("маркер нельзя протащить за противоположный край", r(resizeCrop(mid, "w", 0.9, 0)).width, 0.05);

// --- Перемещение
expect("перемещение", r(moveCrop(mid, 0.1, -0.1)), { x: 0.3, y: 0.1, width: 0.4, height: 0.4 });
expect("перемещение упирается в край", r(moveCrop(mid, 0.9, 0.9)), { x: 0.6, y: 0.6, width: 0.4, height: 0.4 });

// --- Пропорции (в долях снимка; 1 — квадрат в долях)
expect("угол с пропорциями: меньшая сторона догоняет", r(resizeCrop(mid, "se", 0.2, 0, 1)), { x: 0.2, y: 0.2, width: 0.6, height: 0.6 });
expect("сторона с пропорциями: вторая сторона по центру", r(resizeCrop(mid, "e", 0.2, 0, 1)), { x: 0.2, y: 0.1, width: 0.6, height: 0.6 });
expect("пропорции не выходят за край: рамка уменьшается", r(resizeCrop(mid, "se", 0.5, 0, 1)), { x: 0.2, y: 0.2, width: 0.8, height: 0.8 });
expect("выбор пропорций: внутри текущей рамки по центру", r(applyAspect({ x: 0, y: 0, width: 1, height: 0.5 }, 1)),
  { x: 0.25, y: 0, width: 0.5, height: 0.5 });
expect("16:9 на снимке 1600×900 — это 1:1 в долях", aspectInFractions(16 / 9, 1600, 900), 1);
expect("свободные пропорции", aspectInFractions(null, 1600, 900), null);

// --- Кадр целиком и попадание элементов
expect("без кадра — весь снимок", isFullCrop(undefined), true);
expect("весь снимок", isFullCrop({ x: 0, y: 0, width: 1, height: 1 }), true);
expect("часть снимка", isFullCrop(mid), false);
const viewport = { width: 1000, height: 1000 };
expect("элемент в кадре", rectInCrop({ x: 300, y: 300, width: 50, height: 20 }, viewport, mid), true);
expect("элемент вне кадра", rectInCrop({ x: 700, y: 700, width: 50, height: 20 }, viewport, mid), false);
expect("без кадра элемент всегда в кадре", rectInCrop({ x: 700, y: 700, width: 50, height: 20 }, viewport, null), true);

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
