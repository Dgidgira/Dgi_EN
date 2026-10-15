// Автокадр (FR-7): убирает пустые поля по краям скриншота. Результат — обычный кадр
// { x, y, width, height } в долях снимка (как в shared/crop.js), его можно поправить или сбросить.
//
// Как работает: фон — самый частый цвет по краям снимка; строка или столбец пусты, если в них
// почти нет пикселей, заметно отличающихся от фона. Кадр — прямоугольник с содержимым плюс отступ;
// он всегда включает рамки шагов (keepRects), чтобы элемент, с которым работали, не обрезался.
// Пустоту в середине снимка не вырезаем: только поля по краям.

const AUTOCROP_DEFAULTS = {
  // Отличие от фона, при котором пиксель считается содержимым (по самому отличающемуся каналу, 0–255)
  tolerance: 24,
  // Доля «непустых» пикселей, при которой строка или столбец — содержимое (тонкие рамки и тени не в счёт)
  minBusyFraction: 0.004,
  // Отступ вокруг содержимого, доля большей стороны снимка
  padding: 0.015,
  // Кадр не ставится, если он оставляет больше этой доли площади: обрезать почти нечего
  maxKeptArea: 0.9,
  // Кадр не меньше этой доли по каждой стороне
  minSize: 0.1,
};

const roundAutoCrop = (value) => Math.round(value * 10000) / 10000;

// Цвет фона: самый частый цвет пикселей по краям снимка (каналы огрублены до 16 уровней)
function backgroundColor(image) {
  const { width, height, data } = image;
  const counts = new Map();
  const sums = new Map();
  const add = (x, y) => {
    const i = (y * width + x) * 4;
    const key = (data[i] >> 4) * 256 + (data[i + 1] >> 4) * 16 + (data[i + 2] >> 4);
    counts.set(key, (counts.get(key) || 0) + 1);
    const sum = sums.get(key) || [0, 0, 0];
    sum[0] += data[i];
    sum[1] += data[i + 1];
    sum[2] += data[i + 2];
    sums.set(key, sum);
  };
  for (let x = 0; x < width; x++) {
    add(x, 0);
    add(x, height - 1);
  }
  for (let y = 1; y < height - 1; y++) {
    add(0, y);
    add(width - 1, y);
  }
  let best = null;
  for (const [key, count] of counts) if (best === null || count > counts.get(best)) best = key;
  const [r, g, b] = sums.get(best);
  const n = counts.get(best);
  return [r / n, g / n, b / n];
}

// Прямоугольник с содержимым в долях снимка или null, если снимок пустой.
// image — { width, height, data: RGBA по строкам } (как ImageData)
function contentBox(image, options = {}) {
  const { tolerance, minBusyFraction } = { ...AUTOCROP_DEFAULTS, ...options };
  const { width, height, data } = image;
  const [br, bg, bb] = backgroundColor(image);
  const rowBusy = new Array(height).fill(0);
  const colBusy = new Array(width).fill(0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const diff = Math.max(Math.abs(data[i] - br), Math.abs(data[i + 1] - bg), Math.abs(data[i + 2] - bb));
      if (diff > tolerance) {
        rowBusy[y] += 1;
        colBusy[x] += 1;
      }
    }
  }
  const rowLimit = Math.max(1, width * minBusyFraction);
  const colLimit = Math.max(1, height * minBusyFraction);
  const first = (list, limit) => list.findIndex((count) => count > limit);
  const last = (list, limit) => list.length - 1 - [...list].reverse().findIndex((count) => count > limit);
  const top = first(rowBusy, rowLimit);
  const left = first(colBusy, colLimit);
  if (top < 0 || left < 0) return null;
  const bottom = last(rowBusy, rowLimit);
  const right = last(colBusy, colLimit);
  return { x: left / width, y: top / height, width: (right + 1 - left) / width, height: (bottom + 1 - top) / height };
}

// Автокадр: содержимое плюс отступ, объединённое с keepRects (рамки шагов в долях снимка).
// null — обрезать нечего (снимок пустой или кадр оставил бы почти всё)
function autoCrop(image, keepRects = [], options = {}) {
  const settings = { ...AUTOCROP_DEFAULTS, ...options };
  const box = contentBox(image, settings);
  if (!box) return null;
  const padX = (settings.padding * Math.max(image.width, image.height)) / image.width;
  const padY = (settings.padding * Math.max(image.width, image.height)) / image.height;
  let left = box.x - padX;
  let top = box.y - padY;
  let right = box.x + box.width + padX;
  let bottom = box.y + box.height + padY;
  for (const rect of keepRects) {
    left = Math.min(left, rect.x);
    top = Math.min(top, rect.y);
    right = Math.max(right, rect.x + rect.width);
    bottom = Math.max(bottom, rect.y + rect.height);
  }
  left = Math.max(0, left);
  top = Math.max(0, top);
  right = Math.min(1, right);
  bottom = Math.min(1, bottom);
  // Слишком узкий кадр расширяем симметрично до минимального размера
  const grow = (from, to) => {
    const missing = settings.minSize - (to - from);
    if (missing <= 0) return [from, to];
    const start = Math.max(0, Math.min(from - missing / 2, 1 - settings.minSize));
    return [start, start + settings.minSize];
  };
  [left, right] = grow(left, right);
  [top, bottom] = grow(top, bottom);
  if ((right - left) * (bottom - top) > settings.maxKeptArea) return null;
  return { x: roundAutoCrop(left), y: roundAutoCrop(top), width: roundAutoCrop(right - left), height: roundAutoCrop(bottom - top) };
}

// Рамки шагов на снимке (CSS-пиксели окна) — в доли снимка, с запасом под толщину рамки
// и метку с номером шага справа
function framesToKeepRects(frames, viewport) {
  if (!viewport?.width || !viewport?.height) return [];
  return frames.map(({ rect }) => ({
    x: (rect.x - 8) / viewport.width,
    y: (rect.y - 8) / viewport.height,
    width: (rect.width + 16) / viewport.width + 0.03,
    height: (rect.height + 16) / viewport.height,
  }));
}
