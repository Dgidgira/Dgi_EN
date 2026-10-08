// Тексты автора для читателя (FR-11): комментарий к шагу, название скриншота и текст к скриншоту.
// В документе комментарий к шагу — абзац после описания шага; название скриншота — в подписи
// «Рисунок N – Название» (без названия — «Рисунок N – Шаг K»); текст к скриншоту — абзацы основного
// текста сразу после подписи рисунка.
//
// Хранение: chrome.storage.local, ключ "comments" —
// { steps: { <id шага>: текст }, shots: { <id шага>: текст }, titles: { <id шага>: название } }.
// Текст и название скриншота привязаны к шагу, чей снимок показан. Шаги объединяются и разделяются
// (FR-7), поэтому у группы текст к скриншоту собирается со всех её шагов, а название берётся
// у шага со снимком или у последнего шага группы, у которого оно есть.

const COMMENT_MAX = 2000;
const SHOT_TITLE_MAX = 300;

// Текст комментария: без пробелов по краям и лишних пустых строк; null — пустой
function cleanComment(text) {
  const clean = String(text || "")
    .replace(/\r\n?/g, "\n")
    .split("\n").map((line) => line.trim()).join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, COMMENT_MAX);
  return clean || null;
}

// Название скриншота: одна строка; null — пустое
function cleanShotTitle(text) {
  return String(text || "").replace(/\s+/g, " ").trim().slice(0, SHOT_TITLE_MAX) || null;
}

function normalizeComments(comments) {
  return {
    steps: { ...(comments?.steps || {}) },
    shots: { ...(comments?.shots || {}) },
    titles: { ...(comments?.titles || {}) },
  };
}

// Записать комментарий к шагу, текст к скриншоту или название скриншота (kind — "steps", "shots"
// или "titles"); пустой текст удаляет запись
function setComment(comments, kind, stepId, text) {
  const next = normalizeComments(comments);
  const clean = kind === "titles" ? cleanShotTitle(text) : cleanComment(text);
  if (clean) next[kind][stepId] = clean;
  else delete next[kind][stepId];
  return next;
}

function stepComment(comments, stepId) {
  return comments?.steps?.[stepId] || "";
}

// Комментарий к общему скриншоту группы: комментарии к скриншотам всех её шагов по порядку
function groupShotComment(comments, group) {
  return group.items.map(({ step }) => comments?.shots?.[step.id]).filter(Boolean).join("\n\n");
}

// Записать комментарий к скриншоту группы: он хранится у шага, чей снимок показан,
// комментарии остальных шагов группы уже вошли в текст и удаляются
function setGroupShotComment(comments, group, text) {
  let next = normalizeComments(comments);
  for (const { step } of group.items) delete next.shots[step.id];
  next = setComment(next, "shots", group.shotStep.id, text);
  return next;
}

// Название скриншота группы: у шага со снимком, иначе у последнего шага группы, у которого оно есть
function groupShotTitle(comments, group) {
  const titles = comments?.titles || {};
  if (titles[group.shotStep.id]) return titles[group.shotStep.id];
  return [...group.items].reverse().map(({ step }) => titles[step.id]).find(Boolean) || "";
}

// Записать название скриншота группы: хранится у шага со снимком, названия остальных шагов удаляются
function setGroupShotTitle(comments, group, text) {
  const next = normalizeComments(comments);
  for (const { step } of group.items) delete next.titles[step.id];
  return setComment(next, "titles", group.shotStep.id, text);
}

// Абзацы комментария для документа
function commentParagraphs(text) {
  return text ? text.split(/\n+/).filter(Boolean) : [];
}
