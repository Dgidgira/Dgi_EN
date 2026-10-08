// Файл проекта (FR-9): полный снимок записи для автора, чтобы позже открыть её и продолжить правку.
// В отличие от HTML и Word, в файле исходные скриншоты без размытия, поэтому он только для автора.
//
// Формат — JSON:
// { format, version, savedAt, docTitle, steps, maskedFields, maskedAreas, joinedSteps, crops, sections,
//   shots: { <id шага>: data URL } }
// Ошибки и предупреждения возвращаются ключами строк из _locales, как причины отсева в normalize.js.

const PROJECT_FORMAT = "instruction-recorder-project";
const PROJECT_VERSION = 1;
const PROJECT_EXTENSION = "instr.json";
const PROJECT_TITLE_MAX = 200;

// Файл проекта из состояния записи (ключи chrome.storage.local) и скриншотов { <id шага>: data URL }
function buildProject(state, shots, savedAt = new Date()) {
  const steps = state.steps || [];
  const projectShots = {};
  for (const step of steps) {
    if (shots[step.id]) projectShots[step.id] = shots[step.id];
  }
  return JSON.stringify({
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    savedAt: savedAt.toISOString(),
    docTitle: state.docTitle || "",
    steps,
    maskedFields: state.maskedFields || [],
    maskedAreas: state.maskedAreas || {},
    joinedSteps: state.joinedSteps || [],
    crops: state.crops || {},
    sections: state.sections || [],
    shots: projectShots,
  });
}

// --- Проверка ---

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isFraction = (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
// Прямоугольник в долях снимка (маска-область, кадр)
const isFractionRect = (r) => isPlainObject(r) &&
  isFraction(r.x) && isFraction(r.y) && isFraction(r.width) && isFraction(r.height);
// Раздел (FR-10): { id, title, timestamp }
const isSection = (s) => isPlainObject(s) && typeof s.id === "string" && s.id !== "" &&
  typeof s.title === "string" && s.title.trim() !== "" && typeof s.timestamp === "number" && Number.isFinite(s.timestamp);
// Скриншоты пишет только расширение: JPEG или PNG в base64
const isImageDataUrl = (v) => typeof v === "string" && /^data:image\/(jpeg|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(v);

// Разбор и проверка файла проекта.
// Успех: { ok: true, state: {...ключи хранилища}, shots: { <id шага>: data URL }, warnings: [{ key, count }] }
// Ошибка: { ok: false, error: <ключ строки> }. Непригодные необязательные данные (маски, кадры,
// объединение, разделы, скриншоты) отбрасываются с предупреждением; повреждённые шаги — ошибка.
function parseProject(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: "projectErrorNotJson" };
  }
  if (!isPlainObject(raw) || raw.format !== PROJECT_FORMAT || !Number.isInteger(raw.version) || raw.version < 1) {
    return { ok: false, error: "projectErrorFormat" };
  }
  if (raw.version > PROJECT_VERSION) return { ok: false, error: "projectErrorNewerVersion" };

  const steps = raw.steps;
  const ids = new Set();
  const stepsOk = Array.isArray(steps) && steps.every((step) => {
    if (!isPlainObject(step) || typeof step.id !== "string" || !step.id || ids.has(step.id) || typeof step.type !== "string") return false;
    ids.add(step.id);
    return true;
  });
  if (!stepsOk) return { ok: false, error: "projectErrorBroken" };

  let dropped = 0;
  const keep = (list, test) => {
    const kept = list.filter(test);
    dropped += list.length - kept.length;
    return kept;
  };

  const maskedFields = Array.isArray(raw.maskedFields) ? keep(raw.maskedFields, isPlainObject) : [];

  const maskedAreas = {};
  for (const [stepId, areas] of Object.entries(isPlainObject(raw.maskedAreas) ? raw.maskedAreas : {})) {
    if (!ids.has(stepId) || !Array.isArray(areas)) {
      dropped += 1;
      continue;
    }
    const valid = keep(areas, isFractionRect);
    if (valid.length) maskedAreas[stepId] = valid;
  }

  const joinedSteps = Array.isArray(raw.joinedSteps) ? keep([...new Set(raw.joinedSteps)], (id) => ids.has(id)) : [];

  const crops = {};
  for (const [stepId, crop] of Object.entries(isPlainObject(raw.crops) ? raw.crops : {})) {
    if (ids.has(stepId) && isFractionRect(crop)) crops[stepId] = crop;
    else dropped += 1;
  }

  const sectionIds = new Set();
  const sections = Array.isArray(raw.sections)
    ? keep(raw.sections, (section) => isSection(section) && !sectionIds.has(section.id) && sectionIds.add(section.id))
      .map(({ id, title, timestamp }) => ({ id, title: title.trim().slice(0, PROJECT_TITLE_MAX), timestamp }))
    : [];

  const shots = {};
  for (const [stepId, dataUrl] of Object.entries(isPlainObject(raw.shots) ? raw.shots : {})) {
    if (ids.has(stepId) && isImageDataUrl(dataUrl)) shots[stepId] = dataUrl;
    else dropped += 1;
  }

  const docTitle = typeof raw.docTitle === "string" ? raw.docTitle.trim().slice(0, PROJECT_TITLE_MAX) : "";

  // Шаг, у которого при записи был скриншот, а в файле его нет
  const missingShots = steps.filter((step) => step.hasScreenshot && !shots[step.id]).length;
  const warnings = [];
  if (missingShots) warnings.push({ key: "projectWarnMissingShots", count: missingShots });
  if (dropped) warnings.push({ key: "projectWarnDropped", count: dropped });

  return {
    ok: true,
    state: { steps, maskedFields, maskedAreas, joinedSteps, crops, sections, docTitle },
    shots,
    warnings,
  };
}
