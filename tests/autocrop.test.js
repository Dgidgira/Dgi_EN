// Тест автокадра (FR-7): пустые поля по краям скриншота.
// Запуск из корня репозитория: osascript -l JavaScript tests/autocrop.test.js

ObjC.import("Foundation");

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) throw new Error("Не удалось прочитать " + path);
  return text.js;
}

eval(readFile("extension/shared/autocrop.js"));

const failures = [];
let checks = 0;
function expect(name, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n  ожидалось: ${e}\n  получено:  ${a}`);
}
function expectTrue(name, condition, details = "") {
  checks++;
  if (!condition) failures.push(`${name} ${details}`);
}

// Искусственный снимок width×height с фоном и прямоугольниками [x, y, w, h, [r, g, b]] в пикселях
function image(width, height, background, boxes = []) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const box = boxes.find(([bx, by, bw, bh]) => x >= bx && x < bx + bw && y >= by && y < by + bh);
      const [r, g, b] = box ? box[4] : background;
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }
  return { width, height, data };
}
const WHITE = [255, 255, 255];
const DARK = [30, 30, 36];
const GRAY = [120, 120, 120];
const noPad = { padding: 0 };

// --- Содержимое
const form = image(200, 100, WHITE, [[20, 10, 60, 20, GRAY], [20, 40, 80, 10, GRAY]]);
expect("содержимое формы", contentBox(form), { x: 0.1, y: 0.1, width: 0.4, height: 0.4 });
expect("пустой снимок — нет содержимого", contentBox(image(50, 40, WHITE)), null);
expect("тёмный фон: содержимое — светлые блоки",
  contentBox(image(100, 100, DARK, [[50, 50, 20, 20, [230, 230, 230]]])), { x: 0.5, y: 0.5, width: 0.2, height: 0.2 });
expect("едва заметный оттенок (меньше порога) — не содержимое",
  contentBox(image(100, 100, WHITE, [[0, 0, 100, 30, [245, 245, 245]], [40, 50, 20, 20, GRAY]])), { x: 0.4, y: 0.5, width: 0.2, height: 0.2 });
expect("одиночная точка (шум) — не содержимое",
  contentBox(image(400, 400, WHITE, [[399, 0, 1, 1, GRAY], [100, 100, 50, 50, GRAY]])), { x: 0.25, y: 0.25, width: 0.125, height: 0.125 });

// --- Кадр
expect("кадр без отступа совпадает с содержимым", autoCrop(form, [], noPad), { x: 0.1, y: 0.1, width: 0.4, height: 0.4 });
const padded = autoCrop(form);
expectTrue("с отступом кадр чуть шире содержимого", padded.x < 0.1 && padded.y < 0.1 && padded.width > 0.4 && padded.height > 0.4,
  JSON.stringify(padded));
expect("пустой снимок — без кадра", autoCrop(image(50, 40, WHITE)), null);
expect("содержимое почти на весь снимок — без кадра",
  autoCrop(image(100, 100, WHITE, [[2, 2, 96, 96, GRAY]])), null);
expect("рамка шага вне содержимого входит в кадр",
  autoCrop(form, [{ x: 0.8, y: 0.7, width: 0.1, height: 0.1 }], noPad), { x: 0.1, y: 0.1, width: 0.8, height: 0.7 });
expect("кадр не выходит за края снимка",
  autoCrop(form, [{ x: -0.1, y: 0.05, width: 0.2, height: 0.1 }], noPad), { x: 0, y: 0.05, width: 0.5, height: 0.45 });
expect("крошечное содержимое — кадр не меньше 10% по стороне",
  autoCrop(image(1000, 1000, WHITE, [[500, 500, 10, 10, GRAY]]), [], noPad), { x: 0.455, y: 0.455, width: 0.1, height: 0.1 });

// --- Рамки шагов
expect("рамка в пикселях окна → доли снимка с запасом",
  framesToKeepRects([{ rect: { x: 108, y: 58, width: 184, height: 34 } }], { width: 1000, height: 500 }),
  [{ x: 0.1, y: 0.1, width: 0.23, height: 0.1 }]);
expect("без размеров окна — без рамок", framesToKeepRects([{ rect: { x: 0, y: 0, width: 1, height: 1 } }], null), []);

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
