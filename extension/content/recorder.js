// Скрипт страницы: фиксирует действия пользователя (FR-1) и отправляет шаги в background.js.
// Работает только пока включена запись (chrome.storage.local, ключ "recording").

(() => {
  const MAX_LABEL_LENGTH = 80;

  // Элементы, клик по которым считаем осмысленным шагом
  const CLICKABLE_SELECTOR = [
    "button",
    "a[href]",
    "summary",
    "label",
    "input[type=button]",
    "input[type=submit]",
    "input[type=reset]",
    "input[type=checkbox]",
    "input[type=radio]",
    "[role=button]",
    "[role=link]",
    "[role=option]",
    "[role=menuitem]",
    "[role=tab]",
    "[role=checkbox]",
    "[role=radio]",
    "[role=combobox]",
  ].join(",");

  // Поля ввода текста: клик по ним только ставит фокус, шаг пишем по событию change
  const TEXT_INPUT_TYPES = new Set([
    "text", "search", "email", "tel", "url", "password", "number",
    "date", "datetime-local", "time", "month", "week",
  ]);

  let isRecording = false;

  chrome.storage.local.get("recording").then(({ recording = false }) => {
    isRecording = recording;
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local" && "recording" in changes) {
      isRecording = Boolean(changes.recording.newValue);
    }
  });

  function normalizeText(text) {
    const clean = (text || "").replace(/\s+/g, " ").trim();
    return clean.length > MAX_LABEL_LENGTH ? clean.slice(0, MAX_LABEL_LENGTH - 1) + "…" : clean;
  }

  function textOfIds(ids) {
    return ids
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.innerText || "")
      .join(" ");
  }

  // Подпись элемента для шаблонного описания (FR-3, SQ-5).
  // Возвращает текст и источник, чтобы в спайке посчитать, откуда берутся подписи.
  function getLabel(el) {
    const candidates = [
      ["aria-labelledby", () => el.getAttribute("aria-labelledby") && textOfIds(el.getAttribute("aria-labelledby"))],
      ["aria-label", () => el.getAttribute("aria-label")],
      ["label", () => el.labels && Array.from(el.labels).map((l) => l.innerText).join(" ")],
      ["text", () => (isTextInput(el) || el.tagName === "SELECT" ? "" : el.innerText || el.value)],
      ["title", () => el.getAttribute("title")],
      ["placeholder", () => el.getAttribute("placeholder")],
      ["alt", () => el.getAttribute("alt")],
      ["name", () => el.getAttribute("name")],
    ];
    for (const [source, read] of candidates) {
      const text = normalizeText(read());
      if (text) return { text, source };
    }
    return { text: "", source: "none" };
  }

  function isTextInput(el) {
    if (el.tagName === "TEXTAREA") return true;
    return el.tagName === "INPUT" && TEXT_INPUT_TYPES.has((el.type || "text").toLowerCase());
  }

  function isCheckable(el) {
    return el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
  }

  function buildStep(type, el, value) {
    const label = getLabel(el);
    const rect = el.getBoundingClientRect();
    return {
      id: crypto.randomUUID(),
      type,
      label: label.text,
      labelSource: label.source,
      value,
      element: {
        tag: el.tagName.toLowerCase(),
        inputType: el.tagName === "INPUT" ? el.type : null,
        role: el.getAttribute("role"),
      },
      page: { url: location.href, title: document.title },
      // Положение элемента в CSS-пикселях относительно видимой области: по нему рисуется подсветка
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      timestamp: Date.now(),
    };
  }

  function send(message) {
    try {
      chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // Расширение перезагружено, а старый скрипт остался на странице: игнорируем.
    }
  }

  function sendStep(step) {
    send({ type: "step", step });
  }

  // Элемент, клик по которому станет шагом, или null
  function resolveClickTarget(target) {
    const el = target.closest(CLICKABLE_SELECTOR) || clickableByCursor(target);
    if (!el) return null;
    if (isTextInput(el) || el.tagName === "SELECT" || el.tagName === "OPTION") return null;
    // Чекбоксы и радиокнопки пишем по change: так шаг фиксируется и при клике по их label
    if (isCheckable(el)) return null;
    // Клик по label только ставит фокус в связанное поле или переключает чекбокс
    if (el.tagName === "LABEL" && el.control) return null;
    return el;
  }

  // Скриншот для клика делаем при нажатии кнопки мыши, до самого клика (FR-2):
  // после клика страница может уже смениться. background.js привяжет снимок к шагу.
  function onPointerDown(event) {
    if (!isRecording || !event.isTrusted || event.button !== 0) return;
    if (resolveClickTarget(event.target)) send({ type: "capture" });
  }

  function onClick(event) {
    if (!isRecording || !event.isTrusted) return;
    const el = resolveClickTarget(event.target);
    if (el) sendStep(buildStep("click", el, null));
  }

  // Нестандартные элементы (div, span) без роли: считаем кликабельными, если у них курсор-рука.
  // Иначе клик по пустому месту страницы превратится в шаг.
  function clickableByCursor(target) {
    let el = target;
    while (el && el !== document.body) {
      if (getComputedStyle(el).cursor === "pointer") return el;
      el = el.parentElement;
    }
    return null;
  }

  function onChange(event) {
    if (!isRecording || !event.isTrusted) return;
    const el = event.target;

    if (el.tagName === "SELECT") {
      const selected = Array.from(el.selectedOptions).map((o) => normalizeText(o.text)).join(", ");
      sendStep(buildStep("select", el, selected));
    } else if (isCheckable(el)) {
      sendStep(buildStep(el.type, el, el.checked));
    } else if (isTextInput(el)) {
      // Пароли не сохраняем никогда, независимо от ручного маскирования (FR-6)
      const value = el.type === "password" ? "***" : el.value;
      sendStep(buildStep("input", el, value));
    }
  }

  // Фаза перехвата: шаг фиксируется, даже если страница останавливает всплытие события
  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
})();
