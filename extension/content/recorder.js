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

  // Значки-стрелки раскрывающихся элементов («Действия ▾») в подпись не берём
  const ARROW_GLYPHS = /[▾▼▿▴▲⌄⏷]/g;

  function normalizeText(text) {
    const clean = (text || "").replace(ARROW_GLYPHS, " ").replace(/\s+/g, " ").trim();
    return clean.length > MAX_LABEL_LENGTH ? clean.slice(0, MAX_LABEL_LENGTH - 1) + "…" : clean;
  }

  // Текст элементов из aria-labelledby. Элементы внутри самого el пропускаем: так в Angular Material
  // mat-select ссылается и на название поля, и на своё текущее значение («Тип происшествия — выберите —»).
  function textOfIds(ids, el) {
    return ids
      .split(/\s+/)
      .map((id) => document.getElementById(id))
      .filter((ref) => ref && !el.contains(ref))
      .map((ref) => ref.innerText)
      .join(" ");
  }

  function isFormControl(el) {
    const role = el.getAttribute("role");
    return isTextInput(el) || isCheckable(el) || el.tagName === "SELECT" ||
      role === "combobox" || role === "textbox" || role === "listbox";
  }

  // Надпись рядом с полем, не связанная с ним технически (частый случай в реальных системах):
  // ближайший предшествующий label или элемент с "label" в классе, в пределах трёх уровней предков.
  function nearbyLabelText(el) {
    let ancestor = el.parentElement;
    for (let level = 0; ancestor && level < 3; level++, ancestor = ancestor.parentElement) {
      const found = Array.from(ancestor.querySelectorAll("label, [class*=label]")).filter((candidate) =>
        !candidate.contains(el) && !el.contains(candidate) &&
        (candidate.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) &&
        !(candidate.tagName === "LABEL" && candidate.control && candidate.control !== el) &&
        !candidate.querySelector("input, select, textarea, button"));
      if (found.length) return found[found.length - 1].innerText;
    }
    return "";
  }

  function firstText(candidates) {
    for (const [source, read] of candidates) {
      const text = normalizeText(read());
      if (text) return { text, source };
    }
    return { text: "", source: "none" };
  }

  // Название поля без собственного текста элемента. Для выпадающего списка собственный текст —
  // это текущее значение («— выберите —»), а нужно название («Тип происшествия»).
  function getFieldLabel(el) {
    return firstText([
      ["aria-labelledby", () => el.getAttribute("aria-labelledby") && textOfIds(el.getAttribute("aria-labelledby"), el)],
      ["aria-label", () => el.getAttribute("aria-label")],
      ["label", () => el.labels && Array.from(el.labels).map((l) => l.innerText).join(" ")],
      ["nearby-label", () => nearbyLabelText(el)],
    ]);
  }

  // Подпись элемента для шаблонного описания (FR-3, SQ-5).
  // Возвращает текст и источник, чтобы в спайке посчитать, откуда берутся подписи.
  function getLabel(el) {
    return firstText([
      ["aria-labelledby", () => el.getAttribute("aria-labelledby") && textOfIds(el.getAttribute("aria-labelledby"), el)],
      ["aria-label", () => el.getAttribute("aria-label")],
      ["label", () => el.labels && Array.from(el.labels).map((l) => l.innerText).join(" ")],
      ["text", () => (isTextInput(el) || el.tagName === "SELECT" ? "" : el.innerText || el.value)],
      ["title", () => el.getAttribute("title")],
      ["placeholder", () => el.getAttribute("placeholder")],
      ["alt", () => el.getAttribute("alt")],
      // Надпись рядом берём только для полей: у кнопок без подписи она чаще относится к соседнему полю
      ["nearby-label", () => (isFormControl(el) ? nearbyLabelText(el) : "")],
      ["name", () => el.getAttribute("name")],
    ]);
  }

  // Короткий «адрес» элемента на странице: по нему обработка шагов узнаёт одно и то же поле
  function elementPath(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === Node.ELEMENT_NODE && parts.length < 8) {
      if (node.id) {
        parts.unshift("#" + CSS.escape(node.id));
        break;
      }
      let index = 1;
      for (let sibling = node.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (sibling.tagName === node.tagName) index++;
      }
      parts.unshift(`${node.tagName.toLowerCase()}:nth-of-type(${index})`);
      node = node.parentElement;
    }
    return parts.join(" > ");
  }

  // Всплывающий список или меню, внутри которого находится элемент (вариант списка, пункт меню)
  function popupContainer(el) {
    const container = el.closest("[role=listbox], [role=menu], [role=tree], [role=grid]");
    return container ? { role: container.getAttribute("role"), id: container.id || null } : null;
  }

  function isTextInput(el) {
    if (el.tagName === "TEXTAREA") return true;
    return el.tagName === "INPUT" && TEXT_INPUT_TYPES.has((el.type || "text").toLowerCase());
  }

  function isCheckable(el) {
    return el.tagName === "INPUT" && (el.type === "checkbox" || el.type === "radio");
  }

  // Поля, в которых могут быть данные для скрытия (FR-6): ввод, списки, редактируемые области.
  // Чекбоксы, переключатели и кнопки данных не содержат.
  const MASKABLE_SELECTOR = [
    "input:not([type=hidden]):not([type=checkbox]):not([type=radio])" +
      ":not([type=button]):not([type=submit]):not([type=reset]):not([type=image])",
    "textarea",
    "select",
    "[role=combobox]",
    "[role=textbox]",
    "[contenteditable=''], [contenteditable=true]",
  ].join(", ");
  const MAX_FIELDS_PER_STEP = 300;

  const roundRect = (r) => ({ x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) });

  // Всплывающие панели, которые могут лежать поверх поля: раскрытый список, меню, диалог, подсказка
  const OVERLAY_SELECTOR = "[role=listbox], [role=menu], [role=dialog], [role=alertdialog], [role=tooltip], .cdk-overlay-pane";
  // Сетка проверки перекрытия поля: столбцы × строки
  const OCCLUSION_COLS = 12;
  const OCCLUSION_ROWS = 6;

  function visibleOverlayRects() {
    return Array.from(document.querySelectorAll(OVERLAY_SELECTOR))
      .map((overlay) => overlay.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
  }

  function intersects(a, b) {
    return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
  }

  // Точка поля закрыта, если до самого поля над ней лежит элемент всплывающей панели, которая поле не содержит.
  // Подписи и значки внутри поля и прозрачная подложка оверлея поле не закрывают: иначе маска
  // пропустила бы часть данных. Ошибка в сторону «видно» безопаснее: лишнее закроется.
  function isPointCovered(field, x, y) {
    for (const layer of document.elementsFromPoint(x, y)) {
      if (layer === field || field.contains(layer) || layer.contains(field)) return false;
      const overlay = layer.closest(OVERLAY_SELECTOR);
      if (overlay && !overlay.contains(field)) return true;
    }
    return false;
  }

  function isCellVisible(field, x, y) {
    const offscreen = x < 0 || y < 0 || x >= window.innerWidth || y >= window.innerHeight;
    return offscreen || !isPointCovered(field, x, y);
  }

  // Видимые части поля, если его частично закрывает всплывающая панель; null — панелей над полем нет.
  // Соседние видимые клетки строки сетки объединяются в одну полосу.
  function visibleParts(field, r, overlayRects) {
    if (!overlayRects.some((overlay) => intersects(overlay, r))) return null;
    const cellWidth = r.width / OCCLUSION_COLS;
    const cellHeight = r.height / OCCLUSION_ROWS;
    const parts = [];
    for (let row = 0; row < OCCLUSION_ROWS; row++) {
      const y = r.top + (row + 0.5) * cellHeight;
      let start = null;
      for (let col = 0; col <= OCCLUSION_COLS; col++) {
        const visible = col < OCCLUSION_COLS && isCellVisible(field, r.left + (col + 0.5) * cellWidth, y);
        if (visible && start === null) start = col;
        if (!visible && start !== null) {
          parts.push(roundRect({ x: r.left + start * cellWidth, y: r.top + row * cellHeight, width: (col - start) * cellWidth, height: cellHeight }));
          start = null;
        }
      }
    }
    return parts;
  }

  // Положение всех видимых полей на момент шага. Значения полей не сохраняются:
  // только адрес, название и прямоугольник, чтобы закрыть поле на скриншоте.
  function collectVisibleFields() {
    const overlayRects = visibleOverlayRects();
    const fields = [];
    for (const field of document.querySelectorAll(MASKABLE_SELECTOR)) {
      const r = field.getBoundingClientRect();
      const visible = r.width > 0 && r.height > 0 &&
        r.right > 0 && r.bottom > 0 && r.left < window.innerWidth && r.top < window.innerHeight &&
        getComputedStyle(field).visibility !== "hidden";
      if (!visible) continue;
      const entry = { path: elementPath(field), fieldLabel: getFieldLabel(field).text, rect: roundRect(r) };
      // Части поля, не закрытые всплывающей панелью: маска накладывается только на них
      const parts = overlayRects.length ? visibleParts(field, r, overlayRects) : null;
      if (parts) entry.visibleRects = parts;
      fields.push(entry);
      if (fields.length >= MAX_FIELDS_PER_STEP) break;
    }
    return fields;
  }

  // aria-expanded на момент нажатия мыши: некоторые компоненты раскрываются уже по mousedown,
  // и к клику значение успевает измениться
  const expandedAtPointerDown = new WeakMap();

  function buildStep(type, el, value, extra = {}) {
    const label = getLabel(el);
    const fieldLabel = getFieldLabel(el);
    const rect = el.getBoundingClientRect();
    return {
      id: crypto.randomUUID(),
      type,
      label: label.text,
      labelSource: label.source,
      fieldLabel: fieldLabel.text,
      fieldLabelSource: fieldLabel.source,
      value,
      element: {
        tag: el.tagName.toLowerCase(),
        inputType: el.tagName === "INPUT" ? el.type : null,
        role: el.getAttribute("role"),
        path: elementPath(el),
        className: normalizeText(typeof el.className === "string" ? el.className : ""),
        ariaHaspopup: el.getAttribute("aria-haspopup"),
        ariaExpanded: expandedAtPointerDown.has(el) ? expandedAtPointerDown.get(el) : el.getAttribute("aria-expanded"),
        ariaControls: el.getAttribute("aria-controls") || el.getAttribute("aria-owns"),
        container: popupContainer(el),
      },
      page: { url: location.href, title: document.title },
      // Положение элемента в CSS-пикселях относительно видимой области: по нему рисуется подсветка
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      fields: collectVisibleFields(),
      timestamp: Date.now(),
      ...extra,
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
    const el = resolveClickTarget(event.target);
    if (!el) return;
    expandedAtPointerDown.set(el, el.getAttribute("aria-expanded"));
    send({ type: "capture" });
  }

  function onClick(event) {
    if (!isRecording || !event.isTrusted) return;
    const el = resolveClickTarget(event.target);
    if (!el) return;
    sendStep(buildStep("click", el, null));
    expandedAtPointerDown.delete(el);
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

  // Последнее записанное значение каждого поля: чтобы после ввода с Enter
  // не записать то же значение второй раз, когда поле потеряет фокус
  const recordedValues = new WeakMap();

  function recordInput(el, pressedEnter) {
    if (!pressedEnter && recordedValues.get(el) === el.value) return;
    recordedValues.set(el, el.value);
    // Пароли не сохраняем никогда, независимо от ручного маскирования (FR-6)
    const value = el.type === "password" ? "***" : el.value;
    sendStep(buildStep("input", el, value, pressedEnter ? { pressedEnter: true } : {}));
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
      recordInput(el, false);
    }
  }

  // Поле, где Enter отправляет ввод: однострочное поле или многострочное с ролью поиска
  // (например, строка поиска Google сделана как textarea с role="combobox")
  function submitsOnEnter(el) {
    if (el.tagName === "INPUT") return isTextInput(el);
    const role = el.getAttribute("role");
    return el.tagName === "TEXTAREA" && (role === "combobox" || role === "searchbox");
  }

  // Ввод с Enter (поиск, отправка формы): после Enter страница часто сразу уходит на другой адрес,
  // и событие change не наступает. Поэтому значение записываем в момент нажатия.
  function onKeyDown(event) {
    if (!isRecording || !event.isTrusted) return;
    if (event.key !== "Enter" || event.isComposing || event.shiftKey) return;
    const el = event.target;
    if (submitsOnEnter(el)) recordInput(el, true);
  }

  // Фаза перехвата: шаг фиксируется, даже если страница останавливает всплытие события
  // Запасной снимок при раскрытии списка или меню. Снимок по нажатию мыши может опоздать
  // (лимит Chrome — 2 снимка в секунду), и к его выполнению меню уже закроется.
  // Тогда для выбора варианта background.js возьмёт этот снимок.
  const POPUP_SELECTOR = "[role=listbox], [role=menu]";
  // Пауза, чтобы панель успела отрисоваться (анимация раскрытия)
  const POPUP_SHOT_DELAY_MS = 250;
  let popupShotTimer = null;

  function schedulePopupShot() {
    clearTimeout(popupShotTimer);
    popupShotTimer = setTimeout(() => send({ type: "capture", kind: "popup" }), POPUP_SHOT_DELAY_MS);
  }

  function isPopupOpening(mutation) {
    if (mutation.type === "attributes") return mutation.target.getAttribute("aria-expanded") === "true";
    return Array.from(mutation.addedNodes).some((node) =>
      node.nodeType === Node.ELEMENT_NODE && (node.matches(POPUP_SELECTOR) || node.querySelector(POPUP_SELECTOR)));
  }

  new MutationObserver((mutations) => {
    if (isRecording && mutations.some(isPopupOpening)) schedulePopupShot();
  }).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-expanded"] });

  document.addEventListener("pointerdown", onPointerDown, true);
  document.addEventListener("click", onClick, true);
  document.addEventListener("change", onChange, true);
  document.addEventListener("keydown", onKeyDown, true);
})();
