// Тест выгрузки в Word (FR-8): упаковщик ZIP, настройки оформления и сборка .docx.
// Запуск из корня репозитория: osascript -l JavaScript tests/docx.test.js
// Собранный файл проверяется средствами macOS: unzip -t (целостность архива),
// xmllint (правильность XML), textutil (macOS читает .docx и достаёт текст).

ObjC.import("Foundation");
ObjC.import("AppKit");

const app = Application.currentApplication();
app.includeStandardAdditions = true;
const shell = (command) => app.doShellScript(command);

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) throw new Error("Не удалось прочитать " + path);
  return text.js;
}

eval(readFile("extension/shared/zip.js"));
eval(readFile("extension/shared/docx.js"));

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

// Байты ↔ base64 (для обмена с Foundation)
const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
function toBase64(bytes) {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63] +
      (i + 1 < bytes.length ? B64[(n >> 6) & 63] : "=") + (i + 2 < bytes.length ? B64[n & 63] : "=");
  }
  return out;
}
function fromBase64(text) {
  const clean = text.replace(/=+$/, "");
  const bytes = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = (B64.indexOf(clean[i]) << 18) | (B64.indexOf(clean[i + 1]) << 12) |
      ((B64.indexOf(clean[i + 2]) & 63) << 6) | (B64.indexOf(clean[i + 3]) & 63);
    bytes.push((n >> 16) & 255);
    if (i + 2 < clean.length) bytes.push((n >> 8) & 255);
    if (i + 3 < clean.length) bytes.push(n & 255);
  }
  return new Uint8Array(bytes);
}
function writeBytes(path, bytes) {
  const data = $.NSData.alloc.initWithBase64EncodedStringOptions(toBase64(bytes), 0);
  if (!data.writeToFileAtomically(path, true)) throw new Error("Не удалось записать " + path);
}

// Настоящая маленькая JPEG-картинка 4×3, чтобы .docx был полноценным
function sampleJpeg() {
  const rep = $.NSBitmapImageRep.alloc
    .initWithBitmapDataPlanesPixelsWidePixelsHighBitsPerSampleSamplesPerPixelHasAlphaIsPlanarColorSpaceNameBytesPerRowBitsPerPixel(
      null, 4, 3, 8, 3, false, false, $.NSDeviceRGBColorSpace, 0, 0);
  const data = rep.representationUsingTypeProperties($.NSBitmapImageFileTypeJPEG, $());
  return fromBase64(data.base64EncodedStringWithOptions(0).js);
}

// --- UTF-8 и CRC-32
expect("UTF-8: кириллица", Array.from(utf8Encode("Ж")), [0xd0, 0x96]);
expect("UTF-8: ёлочки", Array.from(utf8Encode("«")), [0xc2, 0xab]);
expect("CRC-32 эталонной строки", crc32(utf8Encode("123456789")).toString(16), "cbf43926");

// --- Настройки оформления
const defaults = resolveDocxStyles(undefined);
expect("без файла — значения по умолчанию", defaults.styles.fonts.body, "Calibri");
expect("без файла — без предупреждений", defaults.warnings, []);
const custom = resolveDocxStyles({ fonts: { body: "Times New Roman" }, colors: { stepNumber: "00aa00" }, page: { orientation: "landscape" } });
expect("свой шрифт", custom.styles.fonts.body, "Times New Roman");
expect("шрифт заголовков остался по умолчанию", custom.styles.fonts.headings, "Calibri");
expect("цвет приводится к верхнему регистру", custom.styles.colors.stepNumber, "00AA00");
const broken = resolveDocxStyles({ sizesPt: { body: 500 }, colors: { title: "red" }, page: { size: "A3", marginsMm: { left: "20" } } });
expect("неверные значения → по умолчанию", [broken.styles.sizesPt.body, broken.styles.colors.title, broken.styles.page.size, broken.styles.page.marginsMm.left],
  [11, "1F2937", "A4", 20]);
expect("по предупреждению на каждое неверное значение", broken.warnings.length, 4);

// --- Геометрия страницы и картинок
const a4 = pageGeometry(defaults.styles);
expect("A4: ширина текста между полями 20 и 15 мм", a4.textWidth, 11906 - 1134 - 850);
expect("альбомная: ширина и высота меняются местами", [pageGeometry(custom.styles).width, pageGeometry(custom.styles).height], [16838, 11906]);
const wide = imageExtent({ width: 1600, height: 900 }, defaults.styles);
expect("широкая картинка ужимается до ширины текста", wide.cx, a4.textWidth * 635);
expect("пропорции сохраняются", Math.round((wide.cx / wide.cy) * 100) / 100, Math.round((1600 / 900) * 100) / 100);
expect("маленькая картинка не растягивается", imageExtent({ width: 100, height: 50 }, defaults.styles), { cx: 952500, cy: 476250 });

// --- Сборка .docx и проверка средствами macOS
const jpeg = sampleJpeg();
const doc = {
  title: "Регистрация происшествия <тест> & проверка",
  meta: "Дата: 07.10.2026",
  sections: [
    { heading: "Шаг 1", items: [{ label: null, text: "В поле «Фамилия» введите «Тестов»" }], image: { bytes: jpeg, width: 4, height: 3 } },
    {
      heading: "Шаги 2–3",
      items: [
        { label: "2.", text: "В поле «Телефон заявителя» введите «***»" },
        { label: "3.", text: "Нажмите кнопку «Сохранить»" },
      ],
      image: { bytes: jpeg, width: 4, height: 3 },
    },
    { heading: "Шаг 4", items: [{ label: null, text: "Перейдите по ссылке «Справка»" }], image: null },
  ],
};
const files = docxFiles(doc, defaults.styles, new Date(2026, 9, 7, 12, 0, 0));
expect("состав пакета", files.map((f) => f.name), [
  "[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/document.xml", "word/styles.xml",
  "word/_rels/document.xml.rels", "word/media/image1.jpeg", "word/media/image2.jpeg",
]);

const dir = $.NSTemporaryDirectory().js + "docx-test-" + Date.now();
shell(`mkdir -p '${dir}/parts'`);
const docxPath = `${dir}/test.docx`;
writeBytes(docxPath, buildDocx(doc, defaults.styles, new Date(2026, 9, 7, 12, 0, 0)));

let unzipOk = true;
try { shell(`unzip -t '${docxPath}'`); } catch (e) { unzipOk = false; failures.push("unzip -t: " + e.message); }
expectTrue("архив цел (unzip -t)", unzipOk);

shell(`cd '${dir}/parts' && unzip -q '${docxPath}'`);
for (const part of ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"]) {
  let ok = true;
  try { shell(`xmllint --noout '${dir}/parts/${part}'`); } catch (e) { ok = false; failures.push(`xmllint ${part}: ${e.message}`); }
  expectTrue(`XML без ошибок: ${part}`, ok);
}

const text = shell(`textutil -convert txt -stdout '${docxPath}'`);
for (const expected of [
  "Регистрация происшествия <тест> & проверка", "Дата: 07.10.2026", "Шаг 1", "В поле «Фамилия» введите «Тестов»",
  "Шаги 2–3", "2. В поле «Телефон заявителя» введите «***»", "3. Нажмите кнопку «Сохранить»", "Перейдите по ссылке «Справка»",
]) {
  expectTrue(`textutil читает: ${expected}`, text.includes(expected), `\n  текст документа:\n${text}`);
}
shell(`rm -rf '${dir}'`);

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
