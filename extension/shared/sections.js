// Разделы инструкции (FR-10): автор во время записи создаёт раздел с названием, и все следующие шаги
// попадают в него. В документе раздел — заголовок первого уровня «1 Название», шаги и рисунки
// нумеруются внутри раздела: «Шаг 1.2», «Рисунок 1.2».
//
// Хранение: chrome.storage.local, ключ "sections" — [{ id, title, timestamp }]. Записанные шаги
// не меняются: раздел начинается с первого шага, записанного не раньше его timestamp.
// Требует shared/groups.js (buildGroups).

const SECTION_TITLE_MAX = 200;

// Новый раздел; null — если название пустое
function createSection(title, timestamp, id) {
  const clean = String(title || "").replace(/\s+/g, " ").trim().slice(0, SECTION_TITLE_MAX);
  return clean ? { id, title: clean, timestamp } : null;
}

function renameSection(sections, sectionId, title) {
  const clean = String(title || "").replace(/\s+/g, " ").trim().slice(0, SECTION_TITLE_MAX);
  if (!clean) return sections;
  return sections.map((section) => (section.id === sectionId ? { ...section, title: clean } : section));
}

// Удалённый раздел исчезает, его шаги переходят в предыдущий раздел
function removeSection(sections, sectionId) {
  return sections.filter((section) => section.id !== sectionId);
}

// Части инструкции: [{ section, groups }].
// section — null для шагов до первого раздела, иначе { id, title, timestamp, number };
// number — номер раздела среди непустых разделов (пустой раздел без номера и в документ не попадает).
// groups — как у buildGroups, но объединение не переходит границу раздела, а number шага —
// «номер раздела.номер шага» («2.3»); до первого раздела и без разделов — 1, 2, 3…
function buildParts(steps, joinedSteps, sections) {
  const ordered = [...sections].sort((a, b) => a.timestamp - b.timestamp);
  const parts = [{ section: null, steps: [] }, ...ordered.map((section) => ({ section, steps: [] }))];
  let current = 0;
  for (const step of steps) {
    while (current < ordered.length && ordered[current].timestamp <= step.timestamp) current += 1;
    parts[current].steps.push(step);
  }

  let sectionNumber = 0;
  return parts
    .filter((part) => part.section || part.steps.length)
    .map((part) => {
      const number = part.section && part.steps.length ? ++sectionNumber : null;
      const groups = buildGroups(part.steps, joinedSteps);
      if (number !== null) {
        for (const group of groups) {
          for (const item of group.items) item.number = `${number}.${item.number}`;
        }
      }
      return { section: part.section && { ...part.section, number }, groups };
    });
}
