// Объединение шагов под одним скриншотом (FR-7): автор объединяет соседние шаги, описания
// сохраняются списком, а скриншот остаётся один — от последнего шага группы, с рамками всех шагов.
//
// Хранение: chrome.storage.local, ключ "joinedSteps" — id шагов, объединённых с предыдущим шагом.
// Группа — непрерывная цепочка таких шагов. Записанные шаги и скриншоты не меняются.

// Группы из обработанных шагов. number — номер шага в инструкции (нумерация сквозная)
function buildGroups(steps, joinedSteps) {
  const joined = new Set(joinedSteps);
  const groups = [];
  steps.forEach((step, index) => {
    const item = { step, number: index + 1 };
    const last = groups[groups.length - 1];
    if (last && joined.has(step.id)) last.items.push(item);
    else groups.push({ items: [item] });
  });
  for (const group of groups) group.shotStep = group.items[group.items.length - 1].step;
  return groups;
}

// Объединить шаг с предыдущим или отделить его
function toggleJoin(joinedSteps, stepId) {
  return joinedSteps.includes(stepId)
    ? joinedSteps.filter((id) => id !== stepId)
    : [...joinedSteps, stepId];
}

// Рамка шага на скриншоте группы. Ранние шаги переносятся с поправкой на прокрутку страницы.
// null — элемент на этом скриншоте не виден: другая страница, другой размер окна или ушёл за край.
function rectOnShot(step, shotStep) {
  if (!step.rect || !shotStep.viewport) return null;
  if (step !== shotStep) {
    if (step.page?.url !== shotStep.page?.url) return null;
    const sameViewport = step.viewport &&
      step.viewport.width === shotStep.viewport.width && step.viewport.height === shotStep.viewport.height;
    if (!sameViewport) return null;
  }
  // У шагов старых записей прокрутки нет: считаем, что страница не прокручивалась
  const dx = (step.scroll?.x ?? 0) - (shotStep.scroll?.x ?? 0);
  const dy = (step.scroll?.y ?? 0) - (shotStep.scroll?.y ?? 0);
  const rect = { x: step.rect.x + dx, y: step.rect.y + dy, width: step.rect.width, height: step.rect.height };

  const { width, height } = shotStep.viewport;
  const visible = rect.width > 0 && rect.height > 0 &&
    rect.x < width && rect.y < height && rect.x + rect.width > 0 && rect.y + rect.height > 0;
  return visible ? rect : null;
}

// Произвольная область (FR-6), выделенная на скриншоте шага группы, на общем скриншоте группы.
// Область в долях снимка → в пиксели видимой области → поправка на прокрутку (если страница та же)
// → в доли общего снимка с обрезкой по краям. null — область целиком за краем общего снимка.
// Скрытые автором данные не должны снова появиться после объединения, поэтому без данных
// о размере окна область переносится как есть.
function areaOnShot(area, step, shotStep) {
  if (step.id === shotStep.id) return area;
  const from = step.viewport;
  const to = shotStep.viewport;
  if (!from || !to) return area;

  let x = area.x * from.width;
  let y = area.y * from.height;
  if (step.page?.url === shotStep.page?.url) {
    x += (step.scroll?.x ?? 0) - (shotStep.scroll?.x ?? 0);
    y += (step.scroll?.y ?? 0) - (shotStep.scroll?.y ?? 0);
  }
  const clamp = (value) => Math.min(1, Math.max(0, value));
  const x1 = clamp(x / to.width);
  const y1 = clamp(y / to.height);
  const x2 = clamp((x + area.width * from.width) / to.width);
  const y2 = clamp((y + area.height * from.height) / to.height);
  if (x2 <= x1 || y2 <= y1) return null;
  // Округление, как при сохранении области: без хвостов вроде 0.19999999999999998
  const round = (value) => Math.round(value * 10000) / 10000;
  return { x: round(x1), y: round(y1), width: round(x2 - x1), height: round(y2 - y1) };
}

// Сколько скриншотов будет в инструкции
function countShots(groups) {
  return groups.length;
}
