// Тест выгрузки в HTML (FR-8).
// Запуск из корня репозитория: osascript -l JavaScript tests/html-export.test.js
// Собранный файл проверяется xmllint --html (разбор без ошибок) и на отсутствие внешних ссылок.

ObjC.import("Foundation");

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
eval(readFile("extension/shared/html-export.js"));

const failures = [];
let checks = 0;
function expectTrue(name, condition, details = "") {
  checks++;
  if (!condition) failures.push(`${name} ${details}`);
}

const PIXEL = "data:image/jpeg;base64,/9j/AAAA";
const doc = {
  title: "Регистрация происшествия <script>alert(1)</script> & проверка",
  meta: "Дата: 07.10.2026",
  sections: [
    { heading: "Шаг 1", items: [{ label: null, text: "В поле «Фамилия» введите «<b>Тестов</b>»" }], image: { dataUrl: PIXEL, width: 800, height: 450 } },
    {
      heading: "Шаги 2–3",
      items: [{ label: "2.", text: "В поле «Телефон заявителя» введите «***»" }, { label: "3.", text: "Нажмите кнопку «Сохранить»" }],
      image: { dataUrl: PIXEL, width: 800, height: 450 },
    },
    { heading: "Шаг 4", items: [{ label: null, text: "Перейдите по ссылке «Справка»" }], image: null },
  ],
};
const { styles } = resolveDocxStyles({ fonts: { body: 'Times "New" Roman' }, page: { orientation: "landscape" } });
const html = buildHtml(doc, styles);

expectTrue("заголовок экранирован (нет исполняемого кода)", !html.includes("<script>") && html.includes("&lt;script&gt;"));
expectTrue("текст шага экранирован", html.includes("«&lt;b&gt;Тестов&lt;/b&gt;»"));
expectTrue("одиночный шаг — абзац", html.includes('<p class="step-text">В поле «Фамилия»'));
expectTrue("группа — список с номерами", html.includes('<span class="num">2.</span> В поле «Телефон заявителя» введите «***»'));
expectTrue("картинки встроены", (html.match(/<img src="data:image\/jpeg;base64,/g) || []).length === 2);
expectTrue("шаг без картинки без img", !html.split("Шаг 4")[1].includes("<img"));
expectTrue("нет внешних ссылок", !/(src|href)="(?!data:)/.test(html) && !/url\(/.test(html) && !/@import/.test(html));
expectTrue("шрифт из настроек, без кавычек внутри", html.includes('"Times New Roman", "Segoe UI"'));
expectTrue("страница для печати из настроек", html.includes("@page { size: A4 landscape; margin: 20mm 15mm 20mm 20mm; }"));
expectTrue("кодировка и язык", html.includes('<meta charset="utf-8">') && html.includes('<html lang="ru">'));

const path = $.NSTemporaryDirectory().js + "html-export-test-" + Date.now() + ".html";
$.NSString.alloc.initWithUTF8String(html).writeToFileAtomicallyEncodingError(path, true, $.NSUTF8StringEncoding, null);
// xmllint --html знает только HTML 4, поэтому теги section и figure для него «неизвестные»: такие сообщения пропускаем
const report = shell(`xmllint --html --noout '${path}' 2>&1; true`);
const errors = report.split(/\r|\n/).filter((line) => line.includes("error") && !/Tag (section|figure) invalid/.test(line));
expectTrue("HTML разбирается без ошибок", errors.length === 0, "\n" + errors.join("\n"));
shell(`rm -f '${path}'`);

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
