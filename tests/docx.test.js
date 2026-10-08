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
expect("без файла — оформление шаблона: Times New Roman 12", [defaults.styles.fonts.body, defaults.styles.sizesPt.body], ["Times New Roman", 12]);
expect("без файла — без предупреждений", defaults.warnings, []);
const custom = resolveDocxStyles({ fonts: { body: "Arial" }, colors: { stepNumber: "00aa00" }, page: { orientation: "landscape" }, paragraph: { align: "left" } });
expect("свой шрифт", custom.styles.fonts.body, "Arial");
expect("шрифт заголовков остался по умолчанию", custom.styles.fonts.headings, "Times New Roman");
expect("цвет приводится к верхнему регистру", custom.styles.colors.stepNumber, "00AA00");
expect("своё выравнивание, отступ по умолчанию", [custom.styles.paragraph.align, custom.styles.paragraph.firstLineIndentMm], ["left", 12.5]);
const broken = resolveDocxStyles({
  sizesPt: { body: 500 }, colors: { title: "red" }, page: { size: "A3", marginsMm: { left: "20" } },
  paragraph: { align: "both" }, header: { pageNumbers: "да" },
});
expect("неверные значения → по умолчанию",
  [broken.styles.sizesPt.body, broken.styles.colors.title, broken.styles.page.size, broken.styles.page.marginsMm.left,
    broken.styles.paragraph.align, broken.styles.header.pageNumbers],
  [12, "000000", "A4", 30, "justify", true]);
expect("по предупреждению на каждое неверное значение", broken.warnings.length, 6);

// --- Геометрия страницы и картинок
const a4 = pageGeometry(defaults.styles);
expect("A4: ширина текста между полями 30 и 15 мм", a4.textWidth, 11906 - 1701 - 850);
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
    {
      heading: "Шаг 1", items: [{ label: null, text: "В поле «Фамилия» введите «Тестов»" }], image: { bytes: jpeg, width: 4, height: 3 },
      caption: { label: "Рисунок", number: 1, name: "Шаг 1" },
    },
    {
      heading: "Шаги 2–3",
      items: [
        { label: "2.", text: "В поле «Телефон заявителя» введите «***»" },
        { label: "3.", text: "Нажмите кнопку «Сохранить»" },
      ],
      image: { bytes: jpeg, width: 4, height: 3 },
      caption: { label: "Рисунок", number: 2, name: "Шаги 2–3" },
    },
    { heading: "Шаг 4", items: [{ label: null, text: "Перейдите по ссылке «Справка»" }], image: null, caption: null },
  ],
};
const files = docxFiles(doc, defaults.styles, new Date(2026, 9, 7, 12, 0, 0));
expect("состав пакета", files.map((f) => f.name), [
  "[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/document.xml", "word/styles.xml", "word/header1.xml",
  "word/_rels/document.xml.rels", "word/media/image1.jpeg", "word/media/image2.jpeg",
]);
const part = (name, list = files) => list.find((f) => f.name === name).data;

// --- Оформление по шаблону
const stylesPart = part("word/styles.xml");
expectTrue("основной текст: отступ 1,25 см и по ширине", stylesPart.includes('<w:ind w:firstLine="709"/><w:jc w:val="both"/>'));
expectTrue("основной текст: одинарный интервал, без интервала после абзаца", stylesPart.includes('<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>'));
expectTrue("подпись рисунка: 11 pt по центру", /w:styleId="Caption">.*?<w:jc w:val="center"\/>.*?<w:sz w:val="22"\/>/.test(stylesPart));
const documentPart = part("word/document.xml");
expectTrue("левое поле 30 мм", documentPart.includes('w:left="1701"'));
expectTrue("колонтитул подключён к разделу", documentPart.includes('<w:headerReference w:type="default" r:id="rIdHeader1"/>'));
expectTrue("номер шага чёрный полужирный", documentPart.includes('<w:rPr><w:b/><w:color w:val="000000"/></w:rPr><w:t xml:space="preserve">2. </w:t>'));
expect("подписи — поле SEQ Рисунок", (documentPart.match(/<w:fldSimple w:instr=" SEQ Рисунок \\\* ARABIC ">/g) || []).length, 2);
expectTrue("подпись идёт сразу после скриншота", /<\/w:drawing><\/w:r><\/w:p><w:p><w:pPr><w:pStyle w:val="Caption"\/>/.test(documentPart));
expectTrue("номер страницы в колонтитуле", part("word/header1.xml").includes('<w:fldSimple w:instr=" PAGE ">'));

const plain = docxFiles(doc, resolveDocxStyles({ image: { captions: false }, header: { pageNumbers: false } }).styles);
expectTrue("без подписей и номеров страниц",
  !part("word/document.xml", plain).includes("Caption") && !plain.some((f) => f.name === "word/header1.xml") &&
  !part("word/document.xml", plain).includes("headerReference") && !part("[Content_Types].xml", plain).includes("header"));

const dir = $.NSTemporaryDirectory().js + "docx-test-" + Date.now();
shell(`mkdir -p '${dir}/parts'`);
const docxPath = `${dir}/test.docx`;
writeBytes(docxPath, buildDocx(doc, defaults.styles, new Date(2026, 9, 7, 12, 0, 0)));

let unzipOk = true;
try { shell(`unzip -t '${docxPath}'`); } catch (e) { unzipOk = false; failures.push("unzip -t: " + e.message); }
expectTrue("архив цел (unzip -t)", unzipOk);

shell(`cd '${dir}/parts' && unzip -q '${docxPath}'`);
for (const name of ["[Content_Types].xml", "_rels/.rels", "docProps/core.xml", "word/document.xml", "word/styles.xml",
  "word/header1.xml", "word/_rels/document.xml.rels"]) {
  let ok = true;
  try { shell(`xmllint --noout '${dir}/parts/${name}'`); } catch (e) { ok = false; failures.push(`xmllint ${name}: ${e.message}`); }
  expectTrue(`XML без ошибок: ${name}`, ok);
}

const text = shell(`textutil -convert txt -stdout '${docxPath}'`);
for (const expected of [
  "Регистрация происшествия <тест> & проверка", "Дата: 07.10.2026", "Шаг 1", "В поле «Фамилия» введите «Тестов»",
  "Шаги 2–3", "2. В поле «Телефон заявителя» введите «***»", "3. Нажмите кнопку «Сохранить»", "Перейдите по ссылке «Справка»",
  "Рисунок 1 – Шаг 1", "Рисунок 2 – Шаги 2–3",
]) {
  expectTrue(`textutil читает: ${expected}`, text.includes(expected), `\n  текст документа:\n${text}`);
}
shell(`rm -rf '${dir}'`);

// --- Разделы инструкции (FR-10): раздел — заголовок первого уровня, шаг — второго, подписи «Рисунок 2.1»
const chaptered = {
  title: "С разделами",
  meta: null,
  sections: [
    { heading: "Шаг 1", items: [{ label: null, text: "До раздела" }], image: { bytes: jpeg, width: 4, height: 3 },
      caption: { label: "Рисунок", number: 1, name: "Шаг 1" } },
    { chapter: { number: 1, title: "Вход <в> систему" }, heading: "Шаг 1.1", items: [{ label: null, text: "Введите логин" }],
      image: { bytes: jpeg, width: 4, height: 3 }, caption: { label: "Рисунок", number: "1.1", name: "Шаг 1.1" } },
    { heading: "Шаги 1.2–1.3", items: [{ label: "1.2.", text: "Пароль" }, { label: "1.3.", text: "Войти" }],
      image: { bytes: jpeg, width: 4, height: 3 }, caption: { label: "Рисунок", number: "1.2", name: "Шаги 1.2–1.3" } },
    { chapter: { number: 2, title: "Заявка" }, heading: "Шаг 2.1", items: [{ label: null, text: "Создайте заявку" }],
      image: { bytes: jpeg, width: 4, height: 3 }, caption: { label: "Рисунок", number: "2.1", name: "Шаг 2.1" } },
  ],
};
const chapterFiles = docxFiles(chaptered, defaults.styles);
const chapterDoc = part("word/document.xml", chapterFiles);
const headings = [...chapterDoc.matchAll(/<w:pStyle w:val="(Heading\d)"\/><\/w:pPr><w:r><w:t xml:space="preserve">([^<]*)</g)]
  .map((m) => `${m[1]} ${m[2]}`);
expect("разделы — первый уровень, шаги — второй", headings,
  ["Heading2 Шаг 1", "Heading1 1 Вход &lt;в&gt; систему", "Heading2 Шаг 1.1", "Heading2 Шаги 1.2–1.3", "Heading1 2 Заявка", "Heading2 Шаг 2.1"]);
expectTrue("подпись в разделе: номер раздела текстом, номер рисунка — SEQ с перезапуском в разделе",
  chapterDoc.includes('<w:t xml:space="preserve">Рисунок 2.</w:t></w:r><w:fldSimple w:instr=" SEQ Рисунок \\* ARABIC \\s 1 ">'));
expectTrue("подпись до первого раздела — без номера раздела", chapterDoc.includes('<w:t xml:space="preserve">Рисунок </w:t></w:r><w:fldSimple w:instr=" SEQ Рисунок \\* ARABIC \\s 1 "><w:r><w:t xml:space="preserve">1<'));
const chapterStyles = part("word/styles.xml", chapterFiles);
expectTrue("стиль раздела 13 pt, стиль шага второго уровня 12 pt",
  /w:styleId="Heading1">.*?<w:outlineLvl w:val="0"\/>.*?<w:sz w:val="26"\/>/.test(chapterStyles) &&
  /w:styleId="Heading2">.*?<w:outlineLvl w:val="1"\/>.*?<w:sz w:val="24"\/>/.test(chapterStyles));
expectTrue("без разделов — шаги первого уровня, SEQ без перезапуска, стиля heading 2 нет",
  !stylesPart.includes("Heading2") && !documentPart.includes("\\s 1") && /w:styleId="Heading1">.*?<w:sz w:val="24"\/>/.test(stylesPart));
const chapterPath = `${dir}-chapters.docx`;
writeBytes(chapterPath, buildDocx(chaptered, defaults.styles));
const chapterText = shell(`textutil -convert txt -stdout '${chapterPath}'`);
shell(`rm -f '${chapterPath}'`);
for (const expected of ["1 Вход <в> систему", "Шаги 1.2–1.3", "1.2. Пароль", "Рисунок 1.2 – Шаги 1.2–1.3", "2 Заявка", "Рисунок 2.1 – Шаг 2.1", "Рисунок 1 – Шаг 1"]) {
  expectTrue(`textutil читает: ${expected}`, chapterText.includes(expected), `\n  текст документа:\n${chapterText}`);
}

// --- Комментарии автора (FR-11): после описания шага и между рисунком и подписью
const commented = {
  title: "С комментариями",
  meta: null,
  sections: [
    { heading: "Шаги 1–2", items: [{ label: "1.", text: "Введите логин", comment: "Логин выдаёт администратор\nОн совпадает с почтой" },
      { label: "2.", text: "Войти", comment: "" }],
      image: { bytes: jpeg, width: 4, height: 3 }, figureText: "Кнопка «Войти» внизу формы", caption: { label: "Рисунок", number: 1, name: "Шаги 1–2" } },
  ],
};
const commentedDoc = part("word/document.xml", docxFiles(commented, defaults.styles));
const paragraphOrder = [...commentedDoc.matchAll(/<w:pStyle w:val="([A-Za-z0-9]+)"\/>/g)].map((m) => m[1]);
expect("порядок: шаг, его комментарий по абзацам, шаг без комментария, рисунок, подрисуночный текст, подпись", paragraphOrder,
  ["Title", "Heading1", "StepText", "StepComment", "StepComment", "StepText", "StepImage", "FigureText", "Caption"]);
expectTrue("комментарий и подрисуночный текст держатся с рисунком (keepNext)",
  /w:val="StepComment"\/><w:keepNext\/>/.test(commentedDoc) && /w:val="FigureText"\/><w:keepNext\/>/.test(commentedDoc));
expectTrue("стили комментариев есть", stylesPart.includes('w:styleId="StepComment"') && stylesPart.includes('w:styleId="FigureText"'));
const commentPath = `${dir}-comments.docx`;
writeBytes(commentPath, buildDocx(commented, defaults.styles));
const commentText = shell(`textutil -convert txt -stdout '${commentPath}'`);
shell(`rm -f '${commentPath}'`);
for (const expected of ["Логин выдаёт администратор", "Он совпадает с почтой", "Кнопка «Войти» внизу формы"]) {
  expectTrue(`textutil читает: ${expected}`, commentText.includes(expected), `\n  текст документа:\n${commentText}`);
}

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
