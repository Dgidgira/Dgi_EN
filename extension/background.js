// Фоновый сервис-воркер. Источник правды о состоянии записи: chrome.storage.local, ключ "recording".
// Сервис-воркер может быть выгружен браузером в любой момент, поэтому состояние в переменных не держим.

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

chrome.runtime.onInstalled.addListener(syncBadgeFromStorage);
chrome.runtime.onStartup.addListener(syncBadgeFromStorage);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && "recording" in changes) {
    updateBadge(Boolean(changes.recording.newValue));
  }
});
