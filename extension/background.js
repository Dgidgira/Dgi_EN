// Фоновый сервис-воркер. Источник правды о состоянии записи: chrome.storage.local, ключ "recording".
// Сервис-воркер может быть выгружен браузером в любой момент, поэтому состояние в переменных не держим.
// Шаги записи хранятся там же, ключ "steps" (массив в порядке записи).
// Скриншоты хранятся отдельными ключами "shot:<id шага>" (data URL), чтобы не переписывать их при каждом новом шаге.

const BADGE_COLOR = "#c62828";
const SHOT_PREFIX = "shot:";
const SHOT_FORMAT = { format: "jpeg", quality: 80 };
// Chrome разрешает не больше двух снимков вкладки в секунду
const MIN_CAPTURE_INTERVAL_MS = 550;
// Снимок, сделанный при нажатии мыши, считаем относящимся к клику, если клик пришёл не позже этого срока
const PENDING_SHOT_TTL_MS = 3000;

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

async function clearShots() {
  const all = await chrome.storage.local.get(null);
  const keys = Object.keys(all).filter((key) => key.startsWith(SHOT_PREFIX));
  if (keys.length) await chrome.storage.local.remove(keys);
}

// --- Скриншоты (FR-2) ---

let captureQueue = Promise.resolve();
let lastCaptureAt = 0;

// Снимки делаем строго по очереди и не чаще лимита Chrome. Ошибку не пробрасываем:
// шаг без скриншота лучше, чем потерянный шаг.
function captureTab(windowId) {
  const result = captureQueue.then(async () => {
    const wait = lastCaptureAt + MIN_CAPTURE_INTERVAL_MS - Date.now();
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    lastCaptureAt = Date.now();
    try {
      return { dataUrl: await chrome.tabs.captureVisibleTab(windowId, SHOT_FORMAT), error: null };
    } catch (error) {
      return { dataUrl: null, error: String(error?.message || error) };
    }
  });
  captureQueue = result;
  return result;
}

// Снимки, сделанные при нажатии мыши и ждущие своего клика: tabId -> { promise, createdAt }
const pendingShots = new Map();

function takePendingShot(tabId) {
  const pending = pendingShots.get(tabId);
  pendingShots.delete(tabId);
  if (pending && Date.now() - pending.createdAt <= PENDING_SHOT_TTL_MS) return pending.promise;
  return null;
}

// --- Шаги (FR-1) ---

// Шаги приходят из разных вкладок одновременно: добавляем их строго по очереди,
// иначе параллельные чтения-записи массива потеряют часть шагов.
let appendQueue = Promise.resolve();

function appendStep(step, tab) {
  // Снимок запрашиваем сразу, не дожидаясь очереди, чтобы он соответствовал моменту действия
  const shotPromise =
    (step.type === "click" && takePendingShot(tab.id)) || captureTab(tab.windowId);

  appendQueue = appendQueue.then(async () => {
    const { recording = false, steps = [] } = await chrome.storage.local.get(["recording", "steps"]);
    if (!recording) return;

    const shot = await shotPromise;
    const fullStep = { ...step, tabId: tab.id, hasScreenshot: Boolean(shot.dataUrl), screenshotError: shot.error };
    steps.push(fullStep);

    const update = { steps };
    if (shot.dataUrl) update[SHOT_PREFIX + step.id] = shot.dataUrl;
    await chrome.storage.local.set(update);
  }).catch((error) => console.error("Не удалось сохранить шаг", error));
  return appendQueue;
}

chrome.runtime.onInstalled.addListener(syncBadgeFromStorage);
chrome.runtime.onStartup.addListener(syncBadgeFromStorage);

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && "recording" in changes) {
    const isRecording = Boolean(changes.recording.newValue);
    updateBadge(isRecording);
    // Новая запись: скриншоты прошлой записи больше не нужны (шаги очищает окно расширения)
    if (isRecording) clearShots();
  }
});

chrome.runtime.onMessage.addListener((message, sender) => {
  const tab = sender.tab;
  if (!tab || sender.frameId !== 0) return;

  if (message?.type === "capture") {
    pendingShots.set(tab.id, { promise: captureTab(tab.windowId), createdAt: Date.now() });
  } else if (message?.type === "step") {
    appendStep(message.step, tab);
  }
});
