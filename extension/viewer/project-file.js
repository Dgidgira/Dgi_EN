// Сохранение и открытие файла проекта (FR-9). Работает на странице просмотра поверх viewer.js и export.js
// (SHOT_PREFIX, download, fileName, defaultTitle). Формат и проверка файла — shared/project.js.
//
// Файл содержит исходные скриншоты без размытия: это рабочий файл автора, читателям он не передаётся.
// Открытый проект заменяет текущую запись в chrome.storage.local; страница перерисовывается сама
// по storage.onChanged (viewer.js), как во время записи.

const PROJECT_STATE_KEYS = ["steps", "maskedFields", "maskedAreas", "joinedSteps", "crops", "sections", "comments", "docTitle"];

const projectSaveEl = document.getElementById("project-save");
const projectOpenEl = document.getElementById("project-open");
const projectFileEl = document.getElementById("project-file");
const projectStatusEl = document.getElementById("project-status");

projectSaveEl.textContent = t("projectSave");
projectOpenEl.textContent = t("projectOpen");
document.getElementById("project-hint").textContent = t("projectHint");

function setProjectBusy(busy) {
  projectSaveEl.disabled = busy;
  projectOpenEl.disabled = busy;
}

async function saveProject() {
  setProjectBusy(true);
  try {
    const state = await chrome.storage.local.get(PROJECT_STATE_KEYS);
    const steps = state.steps || [];
    if (!steps.length) {
      projectStatusEl.textContent = t("projectNothing");
      return;
    }
    const stored = await chrome.storage.local.get(steps.map((step) => SHOT_PREFIX + step.id));
    const shots = Object.fromEntries(steps.map((step) => [step.id, stored[SHOT_PREFIX + step.id]]));
    const title = state.docTitle || defaultTitle();
    download(new Blob([buildProject(state, shots)], { type: "application/json" }), fileName(title, PROJECT_EXTENSION));
    projectStatusEl.textContent = t("projectSaved");
  } catch (error) {
    console.error("Не удалось сохранить проект", error);
    projectStatusEl.textContent = t("projectSaveFailed", [String(error?.message || error)]);
  } finally {
    setProjectBusy(false);
  }
}

async function openProject(file) {
  setProjectBusy(true);
  try {
    const { recording = false, steps = [] } = await chrome.storage.local.get(["recording", "steps"]);
    if (recording) {
      projectStatusEl.textContent = t("projectBusyRecording");
      return;
    }
    const parsed = parseProject(await file.text());
    if (!parsed.ok) {
      projectStatusEl.textContent = t("projectOpenFailed", [t(parsed.error)]);
      return;
    }
    if (steps.length && !confirm(t("projectConfirmReplace", [String(steps.length)]))) {
      projectStatusEl.textContent = "";
      return;
    }

    // Скриншоты прошлой записи больше не нужны; новые кладём вместе с остальным состоянием одной записью
    const all = await chrome.storage.local.get(null);
    const oldShots = Object.keys(all).filter((key) => key.startsWith(SHOT_PREFIX));
    if (oldShots.length) await chrome.storage.local.remove(oldShots);
    const shots = Object.fromEntries(Object.entries(parsed.shots).map(([stepId, dataUrl]) => [SHOT_PREFIX + stepId, dataUrl]));
    await chrome.storage.local.set({ ...parsed.state, ...shots, recording: false });

    const notes = parsed.warnings.map(({ key, count }) => t(key, [String(count)]));
    projectStatusEl.textContent = [t("projectOpened", [String(parsed.state.steps.length)]), ...notes].join(" · ");
    if (notes.length) console.warn("Файл проекта открыт с предупреждениями:", notes);
  } catch (error) {
    console.error("Не удалось открыть проект", error);
    projectStatusEl.textContent = t("projectOpenFailed", [String(error?.message || error)]);
  } finally {
    setProjectBusy(false);
  }
}

projectSaveEl.addEventListener("click", saveProject);
projectOpenEl.addEventListener("click", () => projectFileEl.click());
projectFileEl.addEventListener("change", () => {
  const file = projectFileEl.files[0];
  // Сбрасываем выбор, чтобы тот же файл можно было открыть ещё раз
  projectFileEl.value = "";
  if (file) openProject(file);
});
