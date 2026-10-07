// Сборка самодостаточного HTML-файла инструкции (FR-8): картинки встроены (data URL),
// внешних ссылок, шрифтов и скриптов нет, поэтому файл открывается где угодно и не обращается в сеть.
// Есть стили для печати: PDF получается через «Печать → Сохранить как PDF».
// Шрифты, цвета и поля страницы — из тех же настроек, что и Word (config/docx-styles.json).
//
// Модель документа та же, что у shared/docx.js, но у картинки вместо байтов dataUrl:
// { title, meta, sections: [{ heading, items: [{ label, text }], image: { dataUrl, width, height } | null,
//   caption: { label, number, name } | null }] }

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Название шрифта для CSS: в кавычках и с запасными шрифтами (как в шаблоне — с засечками)
function cssFont(name) {
  return `"${String(name).replace(/["\\]/g, "")}", "Liberation Serif", serif`;
}

function htmlSection(section, styles) {
  const parts = [`<h2>${escapeHtml(section.heading)}</h2>`];
  if (section.items.length === 1 && !section.items[0].label) {
    parts.push(`<p class="step-text">${escapeHtml(section.items[0].text)}</p>`);
  } else {
    parts.push('<ol class="items">' + section.items.map((item) =>
      `<li><span class="num">${escapeHtml(item.label || "")}</span> ${escapeHtml(item.text)}</li>`).join("") + "</ol>");
  }
  if (section.image) {
    // Подпись рисунка по ГОСТ 34 / ГОСТ 2.105: «Рисунок 1 – Шаг 1», по центру под рисунком
    const caption = styles.image.captions && section.caption
      ? `<figcaption>${escapeHtml(`${section.caption.label} ${section.caption.number}` +
        (section.caption.name ? ` – ${section.caption.name}` : ""))}</figcaption>`
      : "";
    parts.push(`<figure><img src="${section.image.dataUrl}" width="${section.image.width}" height="${section.image.height}" ` +
      `alt="${escapeHtml(section.heading)}">${caption}</figure>`);
  }
  return `<section class="step">${parts.join("")}</section>`;
}

function buildHtml(doc, styles) {
  const { fonts, sizesPt, colors, page, paragraph, title, spacing, image, header } = styles;
  const m = page.marginsMm;
  const textAlign = paragraph.align;
  // Номер страницы в верхнем поле при печати; без поддержки @top-center браузер его просто не выведет
  const pageNumber = header.pageNumbers
    ? ` @top-center { content: counter(page); font: ${sizesPt.pageNumber}pt ${cssFont(fonts.body)}; }`
    : "";
  const css = `
    @page { size: ${page.size} ${page.orientation}; margin: ${m.top}mm ${m.right}mm ${m.bottom}mm ${m.left}mm;${pageNumber} }
    body { max-width: 900px; margin: 32px auto; padding: 0 16px; font: ${sizesPt.body}pt/${spacing.lineSpacing} ${cssFont(fonts.body)}; color: #${colors.body}; background: #fff; }
    h1 { margin: 0 0 6pt; font: bold ${sizesPt.title}pt/${spacing.lineSpacing} ${cssFont(fonts.headings)}; color: #${colors.title}; text-align: ${title.align}; }
    .meta { margin: 0 0 12pt; font-size: ${sizesPt.meta}pt; color: #${colors.meta}; text-align: ${title.align}; }
    h2 { margin: ${spacing.beforeHeadingPt}pt 0 ${spacing.afterParagraphPt}pt; font: bold ${sizesPt.heading}pt/${spacing.lineSpacing} ${cssFont(fonts.headings)}; color: #${colors.heading}; text-indent: ${paragraph.firstLineIndentMm}mm; text-align: ${textAlign}; break-after: avoid; }
    .step-text, .items li { margin: 0 0 ${spacing.afterParagraphPt}pt; text-indent: ${paragraph.firstLineIndentMm}mm; text-align: ${textAlign}; }
    .items { margin: 0; padding: 0; list-style: none; }
    .num { font-weight: bold; color: #${colors.stepNumber}; }
    figure { margin: ${spacing.beforeImagePt}pt 0 ${spacing.afterImagePt}pt; text-align: center; break-inside: avoid; }
    img { max-width: ${image.maxWidthPercent}%; height: auto; ${image.border ? `border: 1px solid #${image.borderColor};` : ""} }
    figcaption { margin: ${spacing.afterImagePt}pt 0 ${spacing.afterCaptionPt}pt; font-size: ${sizesPt.caption}pt; }
    @media print { body { max-width: none; margin: 0; padding: 0; } }
  `.replace(/\n\s+/g, "\n");

  return "<!doctype html>\n" +
    `<html lang="ru">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
    `<title>${escapeHtml(doc.title)}</title>\n<style>${css}</style>\n</head>\n<body>\n` +
    `<h1>${escapeHtml(doc.title)}</h1>\n` +
    (doc.meta ? `<p class="meta">${escapeHtml(doc.meta)}</p>\n` : "") +
    doc.sections.map((section) => htmlSection(section, styles)).join("\n") +
    "\n</body>\n</html>\n";
}
