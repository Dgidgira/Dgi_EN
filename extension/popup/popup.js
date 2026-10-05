// Всплывающее окно расширения: показывает состояние записи и переключает его.
// Состояние хранится в chrome.storage.local; значок обновляет background.js.

const t = (key) => chrome.i18n.getMessage(key);

const statusEl = document.getElementById("status");
const toggleEl = document.getElementById("toggle");

function render(isRecording) {
  statusEl.textContent = t(isRecording ? "popupStatusRecording" : "popupStatusIdle");
  statusEl.classList.toggle("recording", isRecording);
  toggleEl.textContent = t(isRecording ? "popupStop" : "popupStart");
  toggleEl.classList.toggle("stop", isRecording);
}

async function init() {
  const { recording = false } = await chrome.storage.local.get("recording");
  render(recording);

  toggleEl.addEventListener("click", async () => {
    const { recording: current = false } = await chrome.storage.local.get("recording");
    const next = !current;
    await chrome.storage.local.set({ recording: next });
    render(next);
  });
}

init();
