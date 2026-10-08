// Тест файла проекта (FR-9): сохранение записи и повторное открытие без потерь, отказ для чужих и битых файлов.
// Запуск из корня репозитория: osascript -l JavaScript tests/project.test.js

ObjC.import("Foundation");

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) throw new Error("Не удалось прочитать " + path);
  return text.js;
}

eval(readFile("extension/shared/project.js"));

const failures = [];
let checks = 0;
function expect(name, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n  ожидалось: ${e}\n  получено:  ${a}`);
}

const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2w==";
const state = {
  steps: [
    { id: "s1", type: "input", label: "Фамилия", value: "Тестов", hasScreenshot: true },
    { id: "s2", type: "click", label: "Сохранить", value: null, hasScreenshot: true },
    { id: "s3", type: "click", label: "Справка", value: null, hasScreenshot: false, screenshotError: "лимит" },
  ],
  maskedFields: [{ path: "#phone", fieldLabel: "Телефон", pageKey: "127.0.0.1:8000/forms.html" }],
  maskedAreas: { s1: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }] },
  joinedSteps: ["s2"],
  crops: { s2: { x: 0, y: 0, width: 0.5, height: 0.75 } },
  sections: [{ id: "r1", title: "Вход в систему", timestamp: 5 }],
  comments: { steps: { s1: "Фамилия как в паспорте" }, shots: { s2: "Кнопка внизу формы" }, titles: { s2: "Форма карточки" } },
  docTitle: "Регистрация происшествия (тест)",
};
// Скриншот чужого шага в хранилище в файл не попадает
const shots = { s1: JPEG, s2: JPEG, other: JPEG };

// --- Сохранение и открытие без потерь
const text = buildProject(state, shots, new Date(Date.UTC(2026, 9, 8, 9, 30, 0)));
const saved = JSON.parse(text);
expect("метка формата и версия", [saved.format, saved.version, saved.savedAt], ["instruction-recorder-project", 1, "2026-10-08T09:30:00.000Z"]);
expect("в файл попадают только скриншоты шагов записи", Object.keys(saved.shots), ["s1", "s2"]);

const opened = parseProject(text);
expect("файл открывается", opened.ok, true);
expect("состояние записи восстановлено полностью", opened.state, state);
expect("скриншоты восстановлены", opened.shots, { s1: JPEG, s2: JPEG });
expect("без предупреждений", opened.warnings, []);

// Пустая запись тоже сохраняется и открывается
const empty = parseProject(buildProject({}, {}));
expect("пустая запись", [empty.ok, empty.state.steps, empty.state.docTitle], [true, [], ""]);

// --- Отказы
const variant = (patch) => JSON.stringify({ ...saved, ...patch });
expect("не JSON", parseProject("<html>").error, "projectErrorNotJson");
expect("чужой JSON", parseProject('{"steps": []}').error, "projectErrorFormat");
expect("JSON не объект", parseProject("[1, 2]").error, "projectErrorFormat");
expect("версия не число", parseProject(variant({ version: "1" })).error, "projectErrorFormat");
expect("файл более новой версии", parseProject(variant({ version: 2 })).error, "projectErrorNewerVersion");
expect("шаги не массив", parseProject(variant({ steps: {} })).error, "projectErrorBroken");
expect("шаг без id", parseProject(variant({ steps: [{ type: "click" }] })).error, "projectErrorBroken");
expect("повтор id шага", parseProject(variant({ steps: [state.steps[0], state.steps[0]] })).error, "projectErrorBroken");

// --- Непригодные необязательные данные отбрасываются с предупреждением
const messy = parseProject(variant({
  docTitle: "  " + "Я".repeat(250),
  maskedFields: [state.maskedFields[0], "мусор"],
  maskedAreas: { s1: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.05 }, { x: 2, y: 0, width: 1, height: 1 }], nope: [] },
  joinedSteps: ["s2", "s2", "nope"],
  crops: { s2: { x: 0, y: 0, width: "1", height: 1 }, nope: { x: 0, y: 0, width: 1, height: 1 } },
  shots: { s1: JPEG, s2: "javascript:alert(1)", nope: JPEG },
  comments: { steps: { s1: "Фамилия как в паспорте", nope: "чужой", s2: "  " }, shots: { s2: "Кнопка внизу формы", s3: 5 }, titles: { s2: "Форма карточки", nope: "чужой" } },
  sections: [state.sections[0], state.sections[0], { id: "r2", title: " ", timestamp: 1 }, { id: "r3", title: "Т", timestamp: "1" }],
}));
expect("файл с мусором открывается", messy.ok, true);
expect("название обрезано до 200 символов", messy.state.docTitle.length, 200);
expect("маски полей: мусор отброшен", messy.state.maskedFields, state.maskedFields);
expect("области: неверный прямоугольник и чужой шаг отброшены", messy.state.maskedAreas, state.maskedAreas);
expect("объединение: повтор и чужой шаг отброшены", messy.state.joinedSteps, ["s2"]);
expect("кадры: неверный и чужой отброшены", messy.state.crops, {});
expect("разделы: повтор, пустое название и неверное время отброшены", messy.state.sections, state.sections);
expect("комментарии: чужие, пустые и не строки отброшены", messy.state.comments, state.comments);
expect("скриншоты: только картинки своих шагов", Object.keys(messy.shots), ["s1"]);
expect("предупреждения: нет скриншота у 1 шага, отброшено 15 значений", messy.warnings,
  [{ key: "projectWarnMissingShots", count: 1 }, { key: "projectWarnDropped", count: 15 }]);

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
