// Выгрузка инструкции в HTML и Word (FR-8). Работает на странице просмотра поверх viewer.js:
// берёт последнее показанное состояние (current) и те же слои скриншотов (groupLayers).
//
// Картинки для документа готовятся здесь, в браузере автора, и только из них собирается файл:
// исходные снимки с данными остаются в локальном хранилище и в документ не попадают.
// 1. Размытие полей и областей впечатывается в картинку: область огрубляется крупными блоками
//    и размывается, поэтому восстановить данные из файла нельзя (FR-6).
// 2. Рисуются красные рамки шагов и номера.
// 3. Применяется кадр, ширина уменьшается до EXPORT_MAX_WIDTH.

const EXPORT_MAX_WIDTH = 1600;
const EXPORT_JPEG_QUALITY = 0.9;
const FRAME_COLOR = "#dc2626";

const docTitleEl = document.getElementById("doc-title");
const exportHtmlEl = document.getElementById("export-html");
const exportDocxEl = document.getElementById("export-docx");
const exportStatusEl = document.getElementById("export-status");

document.getElementById("doc-title-label").textContent = t("exportTitleLabel");
exportHtmlEl.textContent = t("exportHtml");
exportDocxEl.textContent = t("exportDocx");

// --- Название инструкции: хранится в chrome.storage.local, ключ "docTitle" ---

function defaultTitle() {
  return current.rawSteps.find((step) => step.page?.title)?.page.title || t("exportDefaultTitle");
}

async function loadTitle() {
  const { docTitle = "" } = await chrome.storage.local.get("docTitle");
  if (document.activeElement !== docTitleEl) docTitleEl.value = docTitle;
  docTitleEl.placeholder = defaultTitle();
}

docTitleEl.addEventListener("change", () => chrome.storage.local.set({ docTitle: docTitleEl.value.trim() }));
chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && "docTitle" in changes) loadTitle();
});
// Подсказка с названием по умолчанию зависит от шагов: обновляем после каждого показа
document.addEventListener("viewer-rendered", loadTitle);

// --- Настройки оформления ---

async function loadExportStyles() {
  let raw;
  try {
    raw = await (await fetch(chrome.runtime.getURL("config/docx-styles.json"))).json();
  } catch (error) {
    console.warn("config/docx-styles.json не прочитан, используются настройки по умолчанию", error);
  }
  const { styles, warnings } = resolveDocxStyles(raw);
  warnings.forEach((warning) => console.warn("config/docx-styles.json:", warning));
  return styles;
}

// --- Картинки ---

function loadImage(dataUrl) {
  const img = new Image();
  img.src = dataUrl;
  return img.decode().then(() => img);
}

// Прямоугольник в пикселях снимка, обрезанный по краям
function clipToImage(rect, width, height) {
  const x = Math.max(0, Math.floor(rect.x));
  const y = Math.max(0, Math.floor(rect.y));
  const right = Math.min(width, Math.ceil(rect.x + rect.width));
  const bottom = Math.min(height, Math.ceil(rect.y + rect.height));
  return right > x && bottom > y ? { x, y, width: right - x, height: bottom - y } : null;
}

// Необратимое размытие: огрубление крупными блоками (не меньше трети высоты области, то есть
// крупнее штрихов символов), затем размытие. Размер блока зависит от масштаба снимка.
function burnBlur(ctx, source, rect, scale) {
  const block = Math.min(Math.round(20 * scale), Math.max(Math.round(8 * scale), Math.round(Math.min(rect.width, rect.height) / 3)));
  const small = document.createElement("canvas");
  small.width = Math.max(1, Math.round(rect.width / block));
  small.height = Math.max(1, Math.round(rect.height / block));
  small.getContext("2d").drawImage(source, rect.x, rect.y, rect.width, rect.height, 0, 0, small.width, small.height);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  ctx.filter = `blur(${Math.max(2, Math.round(block / 2))}px)`;
  // С запасом за края, чтобы размытие не светлело у границ области
  ctx.drawImage(small, rect.x - block, rect.y - block, rect.width + 2 * block, rect.height + 2 * block);
  ctx.restore();
}

// Рамка шага и номер в метке — как на странице просмотра: круг для «3», «таблетка» для «2.13»
function drawFrame(ctx, rect, number, viewport, scale) {
  const pad = HIGHLIGHT_PADDING * scale;
  const x = rect.x * scale - pad;
  const y = rect.y * scale - pad;
  const width = rect.width * scale + 2 * pad;
  const height = rect.height * scale + 2 * pad;
  ctx.save();
  ctx.lineWidth = 3 * scale;
  ctx.strokeStyle = FRAME_COLOR;
  ctx.beginPath();
  ctx.roundRect(x, y, width, height, 6 * scale);
  ctx.stroke();

  if (number !== null) {
    const radius = 10 * scale;
    const gap = 4 * scale;
    ctx.font = `600 ${Math.round(12 * scale)}px system-ui, sans-serif`;
    // Половина ширины метки: не меньше радиуса, с полями 4 px по бокам текста
    const half = Math.max(radius, ctx.measureText(String(number)).width / 2 + 4 * scale);
    const side = badgeSide(rect, viewport);
    const center = {
      "side-right": { cx: x + width + gap + half, cy: y + height / 2 },
      "side-left": { cx: x - gap - half, cy: y + height / 2 },
      "side-top": { cx: x + half, cy: y - gap - radius },
      "side-inside": { cx: x + width - half - 2 * scale, cy: y + radius + 2 * scale },
    }[side];
    ctx.fillStyle = FRAME_COLOR;
    ctx.beginPath();
    ctx.roundRect(center.cx - half, center.cy - radius, 2 * half, 2 * radius, radius);
    ctx.fill();
    ctx.fillStyle = "#fff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(number), center.cx, center.cy + scale);
  }
  ctx.restore();
}

function canvasToJpeg(canvas) {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("Не удалось сохранить картинку"))), "image/jpeg", EXPORT_JPEG_QUALITY));
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

// Готовая картинка группы шагов: { bytes, dataUrl, width, height }
async function renderExportImage(group, dataUrl) {
  const { frames, areas, crop } = groupLayers(group);
  const shotStep = group.shotStep;
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  const viewport = shotStep.viewport || { width, height };
  const scale = width / viewport.width;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0);

  // 1. Размытие: поля (с тем же запасом, что на экране) и произвольные области
  const regions = [
    ...maskedRects(shotStep, masks).map((r) => ({
      x: (r.x - MASK_PADDING) * scale, y: (r.y - MASK_PADDING) * scale,
      width: (r.width + 2 * MASK_PADDING) * scale, height: (r.height + 2 * MASK_PADDING) * scale,
    })),
    ...areas.map(({ area }) => ({ x: area.x * width, y: area.y * height, width: area.width * width, height: area.height * height })),
  ];
  const original = document.createElement("canvas");
  original.width = width;
  original.height = height;
  original.getContext("2d").drawImage(img, 0, 0);
  for (const region of regions) {
    const clipped = clipToImage(region, width, height);
    if (clipped) burnBlur(ctx, original, clipped, scale);
  }

  // 2. Рамки шагов и номера
  for (const { rect, number } of frames) drawFrame(ctx, rect, number, viewport, scale);

  // 3. Кадр и уменьшение
  const c = isFullCrop(crop) ? FULL_CROP : crop;
  const source = { x: c.x * width, y: c.y * height, width: c.width * width, height: c.height * height };
  const factor = Math.min(1, EXPORT_MAX_WIDTH / source.width);
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(source.width * factor));
  out.height = Math.max(1, Math.round(source.height * factor));
  const outCtx = out.getContext("2d");
  outCtx.imageSmoothingQuality = "high";
  outCtx.drawImage(canvas, source.x, source.y, source.width, source.height, 0, 0, out.width, out.height);

  const blob = await canvasToJpeg(out);
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    dataUrl: await blobToDataUrl(blob),
    width: out.width,
    height: out.height,
  };
}

// --- Модель документа ---

async function buildExportDoc(onProgress) {
  const sections = [];
  let done = 0;
  // Разделы инструкции (FR-10): пустые в документ не попадают; рисунки нумеруются внутри раздела
  for (const part of current.parts.filter((p) => p.groups.length)) {
    let figureNumber = 0;
    for (const [index, group] of part.groups.entries()) {
      onProgress(++done, current.groups.length);
      const multi = group.items.length > 1;
      const numbers = group.items.map((item) => item.number);
      const heading = multi
        ? t("viewerGroupNumbers", [String(numbers[0]), String(numbers[numbers.length - 1])])
        : t("viewerStepNumber", [String(numbers[0])]);
      // Значения скрытых полей в тексте — «***»; комментарий автора к шагу — после описания (FR-11)
      const items = group.items.map(({ step, number }) => ({
        label: multi ? `${number}.` : null,
        text: describeStep(maskStep(step, masks)).text,
        comment: stepComment(comments, step.id),
      }));
      const dataUrl = current.shotOf(group.shotStep);
      const image = dataUrl ? await renderExportImage(group, dataUrl) : null;
      // Подпись «Рисунок N – Шаг K» («Рисунок 2.3 – Шаг 2.4» в разделе); шаги без скриншота пропускаются
      const figure = image ? ++figureNumber : null;
      const caption = image
        ? {
          label: t("exportFigureLabel"),
          number: part.section ? `${part.section.number}.${figure}` : figure,
          // Название скриншота, введённое автором, иначе «Шаг K» (FR-11)
          name: groupShotTitle(comments, group) || heading,
        }
        : null;
      const chapter = part.section && index === 0 ? { number: part.section.number, title: part.section.title } : undefined;
      // Текст автора к скриншоту — абзацы после подписи рисунка (FR-11)
      const figureText = image ? groupShotComment(comments, group) : "";
      sections.push({ chapter, heading, items, image, figureText, caption });
    }
  }
  const title = docTitleEl.value.trim() || defaultTitle();
  const meta = t("exportMeta", [new Date().toLocaleDateString("ru-RU")]);
  return { title, meta, sections };
}

// --- Скачивание ---

function fileName(title, extension) {
  const safe = title.replace(/[\\/:*?"<>|\u0000-\u001F]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return `${safe || t("exportDefaultTitle")}.${extension}`;
}

function download(blob, name) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

async function exportDocument(format) {
  if (!current.groups.length) {
    exportStatusEl.textContent = t("exportNothing");
    return;
  }
  exportHtmlEl.disabled = true;
  exportDocxEl.disabled = true;
  try {
    const styles = await loadExportStyles();
    const doc = await buildExportDoc((done, total) => {
      exportStatusEl.textContent = t("exportProgress", [String(done), String(total)]);
    });
    if (format === "html") {
      download(new Blob([buildHtml(doc, styles)], { type: "text/html;charset=utf-8" }), fileName(doc.title, "html"));
    } else {
      const bytes = buildDocx(doc, styles);
      const type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
      download(new Blob([bytes], { type }), fileName(doc.title, "docx"));
    }
    exportStatusEl.textContent = t("exportDone");
  } catch (error) {
    console.error("Выгрузка не удалась", error);
    exportStatusEl.textContent = t("exportFailed", [String(error?.message || error)]);
  } finally {
    exportHtmlEl.disabled = false;
    exportDocxEl.disabled = false;
  }
}

exportHtmlEl.addEventListener("click", () => exportDocument("html"));
exportDocxEl.addEventListener("click", () => exportDocument("docx"));
