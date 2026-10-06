// Кадрирование скриншота (FR-7): рамка в долях снимка { x, y, width, height } (0..1).
// Поведение повторяет инструмент обрезки в «Фотографиях» Windows: маркеры углов и сторон,
// перемещение рамки целиком, фиксированные пропорции.
//
// Хранение: chrome.storage.local, ключ "crops" — { [id шага со скриншотом]: рамка }.
// Сам снимок не меняется; кадр применяется при показе и при выгрузке.

const FULL_CROP = { x: 0, y: 0, width: 1, height: 1 };
// Минимальный размер кадра: меньше — уже не скриншот
const MIN_CROP = 0.05;

const clampCrop = (value, min, max) => Math.min(max, Math.max(min, value));
const roundCrop = (value) => Math.round(value * 10000) / 10000;

function isFullCrop(crop) {
  return !crop || (crop.x <= 0.0001 && crop.y <= 0.0001 && crop.width >= 0.9999 && crop.height >= 0.9999);
}

function roundedCrop(crop) {
  return { x: roundCrop(crop.x), y: roundCrop(crop.y), width: roundCrop(crop.width), height: roundCrop(crop.height) };
}

// Перемещение рамки целиком, не выходя за края снимка
function moveCrop(crop, dx, dy) {
  return {
    ...crop,
    x: clampCrop(crop.x + dx, 0, 1 - crop.width),
    y: clampCrop(crop.y + dy, 0, 1 - crop.height),
  };
}

// Изменение размера маркером: handle — "n", "s", "e", "w" или угол "nw", "ne", "sw", "se".
// aspect — отношение ширины к высоте в долях снимка (null — свободно).
function resizeCrop(crop, handle, dx, dy, aspect = null) {
  let left = crop.x;
  let top = crop.y;
  let right = crop.x + crop.width;
  let bottom = crop.y + crop.height;
  if (handle.includes("w")) left = clampCrop(left + dx, 0, right - MIN_CROP);
  if (handle.includes("e")) right = clampCrop(right + dx, left + MIN_CROP, 1);
  if (handle.includes("n")) top = clampCrop(top + dy, 0, bottom - MIN_CROP);
  if (handle.includes("s")) bottom = clampCrop(bottom + dy, top + MIN_CROP, 1);
  const free = { x: left, y: top, width: right - left, height: bottom - top };
  return aspect ? fitAspect(free, aspect, handle) : free;
}

// Подгоняет рамку под пропорции, не сдвигая противоположный маркеру край (или центр для сторон).
// Угол тянет за собой меньшую сторону; если рамка не помещается в снимок, она уменьшается.
function fitAspect(rect, aspect, handle) {
  let width = rect.width;
  let height = rect.height;
  if (handle === "n" || handle === "s") width = height * aspect;
  else if (handle === "e" || handle === "w") height = width / aspect;
  else if (width / height > aspect) height = width / aspect;
  else width = height * aspect;

  const anchorX = handle.includes("w") ? rect.x + rect.width : handle.includes("e") ? rect.x : rect.x + rect.width / 2;
  const anchorY = handle.includes("n") ? rect.y + rect.height : handle.includes("s") ? rect.y : rect.y + rect.height / 2;
  const maxWidth = handle.includes("w") ? anchorX : handle.includes("e") ? 1 - anchorX : 2 * Math.min(anchorX, 1 - anchorX);
  const maxHeight = handle.includes("n") ? anchorY : handle.includes("s") ? 1 - anchorY : 2 * Math.min(anchorY, 1 - anchorY);
  const scale = Math.min(1, maxWidth / width, maxHeight / height);
  width *= scale;
  height *= scale;

  const x = handle.includes("w") ? anchorX - width : handle.includes("e") ? anchorX : anchorX - width / 2;
  const y = handle.includes("n") ? anchorY - height : handle.includes("s") ? anchorY : anchorY - height / 2;
  return { x, y, width, height };
}

// Выбор пропорций: наибольшая рамка нужных пропорций внутри текущей, по её центру
function applyAspect(crop, aspect) {
  if (!aspect) return crop;
  let width = crop.width;
  let height = crop.height;
  if (width / height > aspect) width = height * aspect;
  else height = width / aspect;
  return { x: crop.x + (crop.width - width) / 2, y: crop.y + (crop.height - height) / 2, width, height };
}

// Пропорции «ширина:высота» в пикселях → в доли снимка данного размера
function aspectInFractions(ratio, imageWidth, imageHeight) {
  return ratio ? (ratio * imageHeight) / imageWidth : null;
}

// Попадает ли прямоугольник элемента (в пикселях видимой области) в кадр
function rectInCrop(rect, viewport, crop) {
  if (isFullCrop(crop)) return true;
  const left = rect.x / viewport.width;
  const top = rect.y / viewport.height;
  const right = (rect.x + rect.width) / viewport.width;
  const bottom = (rect.y + rect.height) / viewport.height;
  return left < crop.x + crop.width && right > crop.x && top < crop.y + crop.height && bottom > crop.y;
}
