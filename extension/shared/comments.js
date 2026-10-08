// Комментарии автора для читателя (FR-11): к шагу и к скриншоту. В документе комментарий к шагу —
// абзац после описания шага, комментарий к скриншоту — подрисуночный текст между рисунком и подписью
// (ГОСТ 2.105: «Рисунок …» и наименование помещают после поясняющих данных).
//
// Хранение: chrome.storage.local, ключ "comments" — { steps: { <id шага>: текст }, shots: { <id шага>: текст } }.
// Комментарий к скриншоту привязан к шагу, чей снимок показан. Шаги объединяются и разделяются
// (FR-7), поэтому у группы комментарий к скриншоту собирается со всех её шагов.

const COMMENT_MAX = 2000;

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

function normalizeComments(comments) {
  return { steps: { ...(comments?.steps || {}) }, shots: { ...(comments?.shots || {}) } };
}

// Записать комментарий к шагу или скриншоту (kind — "steps" или "shots"); пустой текст удаляет комментарий
function setComment(comments, kind, stepId, text) {
  const next = normalizeComments(comments);
  const clean = cleanComment(text);
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

// Абзацы комментария для документа
function commentParagraphs(text) {
  return text ? text.split(/\n+/).filter(Boolean) : [];
}
