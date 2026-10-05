// Фоновый сервис-воркер. Источник правды о состоянии записи: chrome.storage.local, ключ "recording".
// Сервис-воркер может быть выгружен браузером в любой момент, поэтому состояние в переменных не держим.
// Шаги записи хранятся там же, ключ "steps" (массив в порядке записи).

const BADGE_COLOR = "#c62828";

async function updateBadge(isRecording) {
  await chrome.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  await chrome.action.setBadgeText({
    text: isRecording ? chrome.i18n.getMessage("badgeRecording") : "",
  });
}

async function syncBadgeFromStorage() {
  const { recording = false } = await chrome.storage.local.get("recording");
  await updateBadge(recording);
}

// Шаги приходят из разных вкладок одновременно: добавляем их строго по очереди,
// иначе параллельные чтения-записи массива потеряют часть шагов.
let appendQueue = Promise.resolve();

function appendStep(step) {
  appendQueue = appendQueue.then(async () => {
    const { recording = false, steps = [] } = await chrome.storage.local.get(["recording", "steps"]);
    if (!recording) return;
    steps.push(step);
    await chrome.storage.local.set({ steps });
  });
  return appendQueue;
}

chrome.runtime.onInstalled.addListener(syncBadgeFromStorage);
chrome.runtime.onStartup.addListener(syncBadgeFromStorage);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && "recording" in changes) {
    updateBadge(Boolean(changes.recording.newValue));
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  if (message?.type === "step" && sender.tab) {
    appendStep({ ...message.step, tabId: sender.tab.id });
  }
});
