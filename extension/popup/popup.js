// Всплывающее окно расширения: показывает состояние записи и переключает его.
// Состояние хранится в chrome.storage.local; значок обновляет background.js.

const t = (key, substitutions) => chrome.i18n.getMessage(key, substitutions);

const statusEl = document.getElementById("status");
const toggleEl = document.getElementById("toggle");
const stepCountEl = document.getElementById("step-count");

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
    await chrome.storage.local.set(next ? { recording: true, steps: [] } : { recording: false });
    render(next);
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && "steps" in changes) {
      renderStepCount(changes.steps.newValue || []);
    }
  });
}

init();
