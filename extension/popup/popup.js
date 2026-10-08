// Всплывающее окно расширения: показывает состояние записи и переключает его.
// Состояние хранится в chrome.storage.local; значок обновляет background.js.

const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

const statusEl = document.getElementById("status");
const toggleEl = document.getElementById("toggle");
const stepCountEl = document.getElementById("step-count");
const openViewerEl = document.getElementById("open-viewer");
const sectionFormEl = document.getElementById("section-form");
const sectionTitleEl = document.getElementById("section-title");
const sectionCurrentEl = document.getElementById("section-current");

document.getElementById("section-label").textContent = t("popupSectionLabel");
document.getElementById("section-add").textContent = t("popupSectionAdd");
sectionTitleEl.placeholder = t("popupSectionPlaceholder");

openViewerEl.textContent = t("popupOpenViewer");
openViewerEl.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("viewer/viewer.html") });
  window.close();
});

function render(isRecording) {
  statusEl.textContent = t(isRecording ? "popupStatusRecording" : "popupStatusIdle");
  statusEl.classList.toggle("recording", isRecording);
  toggleEl.textContent = t(isRecording ? "popupStop" : "popupStart");
  toggleEl.classList.toggle("stop", isRecording);
  // Разделы создаются только во время записи (FR-10)
  sectionFormEl.hidden = !isRecording;
}

// Текущий раздел — созданный последним: в него попадают следующие шаги
function renderCurrentSection(sections) {
  const last = [...sections].sort((a, b) => a.timestamp - b.timestamp).pop();
  sectionCurrentEl.textContent = last ? t("popupSectionCurrent", [last.title]) : t("popupSectionNone");
}

function renderStepCount(steps) {
  stepCountEl.textContent = t("popupStepCount", [String(steps.length)]);
}

async function init() {
  const { recording = false, steps = [], sections = [] } = await chrome.storage.local.get(["recording", "steps", "sections"]);
  render(recording);
  renderStepCount(steps);
  renderCurrentSection(sections);
  if (recording) sectionTitleEl.focus();

  sectionFormEl.addEventListener("submit", async (event) => {
    event.preventDefault();
    const section = createSection(sectionTitleEl.value, Date.now(), crypto.randomUUID());
    if (!section) return;
    const { sections: stored = [] } = await chrome.storage.local.get("sections");
    await chrome.storage.local.set({ sections: [...stored, section] });
    sectionTitleEl.value = "";
  });

  toggleEl.addEventListener("click", async () => {
    const { recording: current = false } = await chrome.storage.local.get("recording");
    const next = !current;
    // Новая запись начинается с чистого списка шагов; после остановки шаги сохраняются
    // Скрытые поля, области, объединение шагов, кадры, разделы и название относятся к записи и тоже сбрасываются
    const fresh = { recording: true, steps: [], maskedFields: [], maskedAreas: {}, joinedSteps: [], crops: {}, sections: [], docTitle: "" };
    await chrome.storage.local.set(next ? fresh : { recording: false });
    render(next);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && "steps" in changes) {
      renderStepCount(changes.steps.newValue || []);
    }
    if (areaName === "local" && "sections" in changes) {
      renderCurrentSection(changes.sections.newValue || []);
    }
  });
}

init();
