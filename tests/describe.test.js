// Тест шаблонных описаний (FR-3). Node.js не нужен: запускается встроенным в macOS JavaScript.
// Запуск из корня репозитория: osascript -l JavaScript tests/describe.test.js
// Шаблоны берутся из настоящего extension/_locales/ru/messages.json.

ObjC.import("Foundation");

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) throw new Error("Не удалось прочитать " + path);
  return text.js;
}

// Загружаем describeStep в глобальную область, как это делает страница расширения
eval(readFile("extension/shared/describe.js"));
const messages = JSON.parse(readFile("extension/_locales/ru/messages.json"));

// Повторяет подстановку chrome.i18n.getMessage: $NAME$ -> placeholders.name.content ($1, $2) -> substitutions
function t(key, substitutions = []) {
  const message = messages[key];
  if (!message) throw new Error("Нет шаблона " + key);
  return message.message.replace(/\$([A-Za-z_]+)\$/g, (_, name) => {
    const content = message.placeholders[name.toLowerCase()].content;
    return substitutions[Number(content.slice(1)) - 1];
  });
}

const step = (type, label, labelSource, value, element) => ({ type, label, labelSource, value, element });

const cases = [
  [step("input", "Фамилия", "label", "Тестов", { tag: "input", inputType: "text" }), "В поле «Фамилия» введите «Тестов»", true],
  [step("input", "Адрес происшествия", "placeholder", "ул. Тестовая, 1", { tag: "input", inputType: "text" }), "В поле «Адрес происшествия» введите «ул. Тестовая, 1»", true],
  [step("input", "extra_field", "name", "123", { tag: "input", inputType: "text" }), "В выделенное поле введите «123»", false],
  [step("input", "Пароль", "label", "***", { tag: "input", inputType: "password" }), "В поле «Пароль» введите пароль", true],
  [step("input", "Фамилия", "label", "", { tag: "input", inputType: "text" }), "Очистите поле «Фамилия»", true],
  [step("input", "Описание", "label", "а".repeat(150), { tag: "textarea" }), "В поле «Описание» введите «" + "а".repeat(99) + "…»", true],
  [step("select", "Тип происшествия", "label", "Пожар", { tag: "select" }), "В списке «Тип происшествия» выберите «Пожар»", true],
  [step("select", "", "none", "Пожар", { tag: "select" }), "В выделенном списке выберите «Пожар»", false],
  [step("checkbox", "Есть пострадавшие", "label", true, { tag: "input", inputType: "checkbox" }), "Отметьте «Есть пострадавшие»", true],
  [step("checkbox", "Есть пострадавшие", "label", false, { tag: "input", inputType: "checkbox" }), "Снимите отметку «Есть пострадавшие»", true],
  [step("radio", "Высокий", "label", true, { tag: "input", inputType: "radio" }), "Выберите вариант «Высокий»", true],
  [step("click", "Сохранить", "text", null, { tag: "button" }), "Нажмите кнопку «Сохранить»", true],
  [step("click", "Распечатать карточку", "aria-label", null, { tag: "button" }), "Нажмите кнопку «Распечатать карточку»", true],
  [step("click", "Передать в службу", "text", null, { tag: "input", inputType: "submit" }), "Нажмите кнопку «Передать в службу»", true],
  [step("click", "Справка", "text", null, { tag: "a" }), "Перейдите по ссылке «Справка»", true],
  [step("click", "Пожар", "text", null, { tag: "div", role: "option" }), "Выберите «Пожар»", true],
  [step("click", "Заявитель", "text", null, { tag: "div", role: "tab" }), "Откройте вкладку «Заявитель»", true],
  [step("click", "Нестандартная кнопка", "text", null, { tag: "span", role: null }), "Нажмите «Нестандартная кнопка»", true],
  [step("click", "", "none", null, { tag: "div" }), "Нажмите на выделенный элемент", false],
  [step("unknown", "", "none", null, {}), "Выполните действие с выделенным элементом", false],
];

const failures = [];
cases.forEach(([input, expectedText, expectedUsesLabel], i) => {
  const actual = describeStep(input, t);
  if (actual.text !== expectedText || actual.usesLabel !== expectedUsesLabel) {
    failures.push(`#${i + 1}: ожидалось «${expectedText}» (${expectedUsesLabel}), получено «${actual.text}» (${actual.usesLabel})`);
  }
});

// Для каждого шаблона должен быть вариант без подписи (иначе chrome.i18n вернёт пустую строку)
const templateBases = [
  "ClickButton", "ClickLink", "ClickTab", "ClickOption", "ClickGeneric",
  "Input", "InputClear", "InputPassword", "Select", "CheckboxOn", "CheckboxOff", "Radio",
];
templateBases.forEach((base) => {
  ["", "NoLabel"].forEach((suffix) => {
    if (!messages["describe" + base + suffix]) failures.push("Нет шаблона describe" + base + suffix);
  });
});

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${cases.length}\n` + failures.join("\n")
  : `OK: ${cases.length} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
