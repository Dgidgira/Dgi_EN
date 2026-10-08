// Тест разделов инструкции (FR-10).
// Запуск из корня репозитория: osascript -l JavaScript tests/sections.test.js

ObjC.import("Foundation");

function readFile(path) {
  const text = $.NSString.stringWithContentsOfFileEncodingError(path, $.NSUTF8StringEncoding, null);
  if (text.isNil()) throw new Error("Не удалось прочитать " + path);
  return text.js;
}

eval(readFile("extension/shared/groups.js"));
eval(readFile("extension/shared/sections.js"));

const failures = [];
let checks = 0;
function expect(name, actual, expected) {
  checks++;
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) failures.push(`${name}\n  ожидалось: ${e}\n  получено:  ${a}`);
}

// Шаги a–f записаны в моменты 10, 20, … 60
const steps = ["a", "b", "c", "d", "e", "f"].map((id, i) => ({ id, timestamp: (i + 1) * 10 }));
// Вид частей: «номер раздела Название: группы», группа — шаги с номерами через пробел
const shape = (parts) => parts.map(({ section, groups }) =>
  `${section ? `${section.number ?? "-"} ${section.title}` : "—"}: ` +
  groups.map((g) => g.items.map((i) => `${i.step.id}${i.number}`).join(" ")).join(" | "));

// --- Создание и правка
expect("название очищается от лишних пробелов", createSection("  Вход \n в систему ", 5, "s1"), { id: "s1", title: "Вход в систему", timestamp: 5 });
expect("пустое название не принимается", createSection("   ", 5, "s1"), null);
expect("длинное название обрезается", createSection("Я".repeat(300), 5, "s1").title.length, 200);
const two = [createSection("Вход", 15, "s1"), createSection("Заявка", 35, "s2")];
expect("переименование", renameSection(two, "s2", " Новая заявка ").map((s) => s.title), ["Вход", "Новая заявка"]);
expect("пустое переименование ничего не меняет", renameSection(two, "s2", ""), two);
expect("удаление", removeSection(two, "s1").map((s) => s.id), ["s2"]);

// --- Разбивка на разделы
expect("без разделов — как раньше, сквозные номера", shape(buildParts(steps, [], [])), ["—: a1 | b2 | c3 | d4 | e5 | f6"]);
expect("шаги до первого раздела без раздела, нумерация внутри разделов",
  shape(buildParts(steps, [], two)), ["—: a1", "1 Вход: b1.1 | c1.2", "2 Заявка: d2.1 | e2.2 | f2.3"]);
expect("раздел, созданный до первого шага, забирает все шаги",
  shape(buildParts(steps, [], [createSection("Всё", 0, "s0")])), ["1 Всё: a1.1 | b1.2 | c1.3 | d1.4 | e1.5 | f1.6"]);
expect("порядок разделов — по времени создания, а не по месту в списке",
  shape(buildParts(steps, [], [two[1], two[0]])), ["—: a1", "1 Вход: b1.1 | c1.2", "2 Заявка: d2.1 | e2.2 | f2.3"]);
expect("шаг в момент создания раздела уже в разделе", shape(buildParts(steps, [], [createSection("С", 30, "s")])),
  ["—: a1 | b2", "1 С: c1.1 | d1.2 | e1.3 | f1.4"]);

// Два раздела подряд без шагов между ними и раздел в конце записи: пустые, без номера
const withEmpty = [createSection("Пустой", 12, "e1"), createSection("Вход", 15, "s1"), createSection("Хвост", 99, "e2")];
expect("пустые разделы без номера, номера непустых подряд",
  shape(buildParts(steps, [], withEmpty)), ["—: a1", "- Пустой: ", "1 Вход: b1.1 | c1.2 | d1.3 | e1.4 | f1.5", "- Хвост: "]);

// --- Объединение шагов не переходит границу раздела
expect("объединение внутри раздела", shape(buildParts(steps, ["c", "f"], two)),
  ["—: a1", "1 Вход: b1.1 c1.2", "2 Заявка: d2.1 | e2.2 f2.3"]);
expect("отметка первого шага раздела не объединяет его с прошлым разделом",
  shape(buildParts(steps, ["b", "d"], two)), ["—: a1", "1 Вход: b1.1 | c1.2", "2 Заявка: d2.1 | e2.2 | f2.3"]);
expect("после удаления раздела отметка снова объединяет шаги",
  shape(buildParts(steps, ["d"], removeSection(two, "s2"))), ["—: a1", "1 Вход: b1.1 | c1.2 d1.3 | e1.4 | f1.5"]);

const result = failures.length
  ? `ПРОВАЛ: ${failures.length} из ${checks}\n` + failures.join("\n")
  : `OK: ${checks} проверок пройдено`;
if (failures.length) throw new Error(result);
result;
