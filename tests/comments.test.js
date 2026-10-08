// Тест комментариев к шагам и скриншотам (FR-11).
// Запуск из корня репозитория: osascript -l JavaScript tests/comments.test.js

ObjC.import("Foundation");

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) throw new Error("Не удалось прочитать " + path);
  return text.js;
}

eval(readFile("extension/shared/comments.js"));

const failures = [];
let checks = 0;
function expect(name, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n  ожидалось: ${e}\n  получено:  ${a}`);
}

// --- Текст
expect("пробелы по краям строк и комментария убираются", cleanComment("  Проверьте \r\n  номер  \n"), "Проверьте\nномер");
expect("больше одной пустой строки подряд не бывает", cleanComment("а\n\n\n\nб"), "а\n\nб");
expect("пустой комментарий — null", cleanComment(" \n "), null);
expect("длина ограничена", cleanComment("я".repeat(3000)).length, 2000);
expect("абзацы для документа", commentParagraphs("Первый\n\nВторой\nТретий"), ["Первый", "Второй", "Третий"]);
expect("пустой комментарий — без абзацев", commentParagraphs(""), []);

// --- Комментарии к шагам
let comments = setComment(undefined, "steps", "a", "Поле обязательное");
expect("комментарий к шагу записан", stepComment(comments, "a"), "Поле обязательное");
expect("исходный объект не меняется", setComment(comments, "steps", "a", "Другой") !== comments && stepComment(comments, "a"), "Поле обязательное");
comments = setComment(comments, "steps", "a", "  ");
expect("пустой текст удаляет комментарий", comments, { steps: {}, shots: {} });
expect("нет комментария — пустая строка", stepComment(undefined, "x"), "");

// --- Комментарии к скриншотам групп
const item = (id) => ({ step: { id } });
const single = { items: [item("a")], shotStep: { id: "a" } };
const group = { items: [item("a"), item("b"), item("c")], shotStep: { id: "c" } };
comments = setGroupShotComment(undefined, single, "Снимок шага a");
comments = setComment(comments, "shots", "c", "Снимок шага c");
expect("у группы собраны комментарии скриншотов всех шагов", groupShotComment(comments, group), "Снимок шага a\n\nСнимок шага c");
comments = setGroupShotComment(comments, group, "Общий текст");
expect("правка группы: текст у шага со снимком, остальные удалены", comments.shots, { c: "Общий текст" });
expect("после разделения комментарий остаётся у шага со снимком", groupShotComment(comments, single), "");
expect("пустая правка группы удаляет комментарий", setGroupShotComment(comments, group, "").shots, {});

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
