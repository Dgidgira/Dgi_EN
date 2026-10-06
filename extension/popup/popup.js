// Всплывающее окно расширения: показывает состояние записи и переключает его.
// Состояние хранится в chrome.storage.local; значок обновляет background.js.

const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

const statusEl = document.getElementById("status");
const toggleEl = document.getElementById("toggle");
const stepCountEl = document.getElementById("step-count");
const openViewerEl = document.getElementById("open-viewer");

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
}

function renderStepCount(steps) {
  stepCountEl.textContent = t("popupStepCount", [String(steps.length)]);
}

async function init() {
  const { recording = false, steps = [] } = await chrome.storage.local.get(["recording", "steps"]);
  render(recording);
  renderStepCount(steps);

  toggleEl.addEventListener("click", async () => {
    const { recording: current = false } = await chrome.storage.local.get("recording");
    const next = !current;
    // Новая запись начинается с чистого списка шагов; после остановки шаги сохраняются
    // Скрытые поля, области, объединение шагов, кадры и название относятся к записи и тоже сбрасываются
    const fresh = { recording: true, steps: [], maskedFields: [], maskedAreas: {}, joinedSteps: [], crops: {}, docTitle: "" };
    await chrome.storage.local.set(next ? fresh : { recording: false });
    render(next);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && "steps" in changes) {
      renderStepCount(changes.steps.newValue || []);
    }
  });
}

init();
