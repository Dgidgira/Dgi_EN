// Сборка документа Word (.docx) для выгрузки инструкции (FR-8). Без сторонних библиотек:
// XML-части пишутся вручную и упаковываются в ZIP (shared/zip.js).
// Оформление (шрифты, размеры, цвета, поля, интервалы) — из extension/config/docx-styles.json,
// описание параметров — docs/docx-styles.md.
//
// Модель документа (её собирает страница просмотра):
// { title, meta, sections: [{ chapter: { number, title } | undefined, heading, items: [{ label, text, comment }],
//   image: { bytes, width, height } | null, figureText, caption: { label, number, name } | null }] }
// comment — комментарий автора к шагу, абзацы через перевод строки (FR-11); figureText — текст автора
// к скриншоту: абзацы основного текста сразу после подписи рисунка; caption.name — название скриншота
// или «Шаг K»;
// chapter — у первого блока раздела инструкции (FR-10): перед блоком заголовок первого уровня «1 Название»,
// а заголовки шагов опускаются на второй уровень; label — номер шага («3.» или «2.3.») или null;
// image.bytes — JPEG; caption — подпись рисунка по ГОСТ 34 / ГОСТ 2.105: «Рисунок 1 – Шаг 1»,
// в разделах — «Рисунок 2.3 – Шаг 2.4».

// --- Настройки оформления ---

// По умолчанию — оформление корпоративного шаблона (стили «КИСУСС_…»): Times New Roman 12,
// одинарный интервал, абзацный отступ 1,25 см, выравнивание по ширине, левое поле 30 мм
const DEFAULT_DOCX_STYLES = {
  fonts: { body: "Times New Roman", headings: "Times New Roman" },
  sizesPt: { title: 13, section: 13, heading: 12, body: 12, meta: 12, caption: 11, pageNumber: 10 },
  colors: { title: "000000", heading: "000000", body: "000000", meta: "000000", stepNumber: "000000" },
  page: { size: "A4", orientation: "portrait", marginsMm: { top: 20, right: 15, bottom: 20, left: 30 } },
  paragraph: { align: "justify", firstLineIndentMm: 12.5 },
  title: { align: "center" },
  spacing: {
    afterParagraphPt: 0, beforeSectionPt: 18, beforeHeadingPt: 12, beforeImagePt: 6, afterImagePt: 6, afterCaptionPt: 6, lineSpacing: 1,
  },
  image: { maxWidthPercent: 100, border: true, borderColor: "D1D5DB", captions: true },
  header: { pageNumbers: true },
};

// Выравнивание абзаца: значение настроек → значение Word
const ALIGN_WORD = { left: "left", center: "center", right: "right", justify: "both" };

// Размеры страниц в twips (1/1440 дюйма)
const PAGE_SIZES_TWIPS = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } };

// Проверки значений: неверное значение заменяется значением по умолчанию с предупреждением
const isFont = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 64;
const isColor = (v) => typeof v === "string" && /^[0-9A-Fa-f]{6}$/.test(v);
const inRange = (min, max) => (v) => typeof v === "number" && v >= min && v <= max;

const isBoolean = (v) => typeof v === "boolean";
const isAlign = (v) => typeof v === "string" && Object.hasOwn(ALIGN_WORD, v);

const DOCX_STYLE_RULES = {
  fonts: { body: isFont, headings: isFont },
  sizesPt: {
    title: inRange(6, 72), section: inRange(6, 72), heading: inRange(6, 72), body: inRange(6, 72), meta: inRange(6, 72),
    caption: inRange(6, 72), pageNumber: inRange(6, 72),
  },
  colors: { title: isColor, heading: isColor, body: isColor, meta: isColor, stepNumber: isColor },
  page: {
    size: (v) => v in PAGE_SIZES_TWIPS,
    orientation: (v) => v === "portrait" || v === "landscape",
    marginsMm: { top: inRange(0, 100), right: inRange(0, 100), bottom: inRange(0, 100), left: inRange(0, 100) },
  },
  paragraph: { align: isAlign, firstLineIndentMm: inRange(0, 50) },
  title: { align: isAlign },
  spacing: {
    afterParagraphPt: inRange(0, 72), beforeSectionPt: inRange(0, 72), beforeHeadingPt: inRange(0, 72), beforeImagePt: inRange(0, 72),
    afterImagePt: inRange(0, 72), afterCaptionPt: inRange(0, 72), lineSpacing: inRange(0.5, 3),
  },
  image: { maxWidthPercent: inRange(10, 100), border: isBoolean, borderColor: isColor, captions: isBoolean },
  header: { pageNumbers: isBoolean },
};

// Настройки из файла поверх значений по умолчанию. warnings — что было отброшено и почему
function resolveDocxStyles(raw) {
  const warnings = [];
  const merge = (defaults, rules, value, path) => {
    const result = {};
    for (const key of Object.keys(defaults)) {
      const fieldPath = path ? `${path}.${key}` : key;
      const given = value && typeof value === "object" ? value[key] : undefined;
      if (typeof rules[key] === "object") {
        result[key] = merge(defaults[key], rules[key], given, fieldPath);
      } else if (given === undefined) {
        result[key] = defaults[key];
      } else if (rules[key](given)) {
        result[key] = typeof given === "string" && isColor(given) ? given.toUpperCase() : given;
      } else {
        warnings.push(`${fieldPath}: недопустимое значение ${JSON.stringify(given)}, используется ${JSON.stringify(defaults[key])}`);
        result[key] = defaults[key];
      }
    }
    return result;
  };
  return { styles: merge(DEFAULT_DOCX_STYLES, DOCX_STYLE_RULES, raw, ""), warnings };
}

const mmToTwips = (mm) => Math.round((mm * 1440) / 25.4);
const ptToTwips = (pt) => Math.round(pt * 20);
const ptToHalfPoints = (pt) => Math.round(pt * 2);
// 1 twip = 635 EMU (единица размеров рисунков в Word); 1 пиксель при 96 dpi = 9525 EMU
const TWIP_EMU = 635;
const PIXEL_EMU = 9525;

// Страница с учётом ориентации и ширина текста между полями, в twips
function pageGeometry(styles) {
  const base = PAGE_SIZES_TWIPS[styles.page.size];
  const landscape = styles.page.orientation === "landscape";
  const width = landscape ? base.height : base.width;
  const height = landscape ? base.width : base.height;
  const margins = Object.fromEntries(Object.entries(styles.page.marginsMm).map(([k, v]) => [k, mmToTwips(v)]));
  return { width, height, margins, textWidth: width - margins.left - margins.right };
}

// Размер картинки в документе (EMU): по пикселям при 96 dpi, но не шире заданной доли ширины текста
function imageExtent(image, styles) {
  const maxWidth = Math.round((pageGeometry(styles).textWidth * TWIP_EMU * styles.image.maxWidthPercent) / 100);
  let cx = image.width * PIXEL_EMU;
  let cy = image.height * PIXEL_EMU;
  if (cx > maxWidth) {
    cy = Math.round((cy * maxWidth) / cx);
    cx = maxWidth;
  }
  return { cx, cy };
}

// --- XML ---

function escapeXml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Управляющие символы недопустимы в XML
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

const NS_W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_WP = "http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_PIC = "http://schemas.openxmlformats.org/drawingml/2006/picture";
const XML_HEADER = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';

function textRun(text, props = "") {
  const rPr = props ? `<w:rPr>${props}</w:rPr>` : "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r>`;
}

function paragraph(style, content, extraProps = "") {
  return `<w:p><w:pPr><w:pStyle w:val="${style}"/>${extraProps}</w:pPr>${content}</w:p>`;
}

function drawing(extent, relId, index, styles) {
  const border = styles.image.border
    ? `<a:ln w="9525"><a:solidFill><a:srgbClr val="${styles.image.borderColor}"/></a:solidFill></a:ln>`
    : "";
  return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0">` +
    `<wp:extent cx="${extent.cx}" cy="${extent.cy}"/>` +
    `<wp:docPr id="${index}" name="Скриншот ${index}"/>` +
    `<wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr>` +
    `<a:graphic><a:graphicData uri="${NS_PIC}"><pic:pic>` +
    `<pic:nvPicPr><pic:cNvPr id="${index}" name="image${index}.jpeg"/><pic:cNvPicPr/></pic:nvPicPr>` +
    `<pic:blipFill><a:blip r:embed="${relId}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill>` +
    `<pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${extent.cx}" cy="${extent.cy}"/></a:xfrm>` +
    `<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>${border}</pic:spPr>` +
    `</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
}

// Подпись рисунка: «Рисунок 1 – Шаг 1». Номер — поле SEQ, как у подписей, вставленных в самом Word:
// по ним работает «Список иллюстраций», а Word пересчитывает номера при правке документа.
// В разделах номер «2.3»: номер раздела — текстом, номер рисунка — SEQ с ключом \s 1
// (счёт заново после каждого заголовка первого уровня, то есть в каждом разделе)
function captionContent(caption, bySection) {
  const sequence = String(caption.label).replace(/[^\p{L}\p{N}_]/gu, "") || "Figure";
  const number = String(caption.number);
  const dot = number.lastIndexOf(".");
  const prefix = dot >= 0 ? number.slice(0, dot + 1) : "";
  const restart = bySection ? " \\s 1" : "";
  return textRun(`${caption.label} ${prefix}`) +
    `<w:fldSimple w:instr=" SEQ ${sequence} \\* ARABIC${restart} ">${textRun(number.slice(dot + 1))}</w:fldSimple>` +
    (caption.name ? textRun(` – ${caption.name}`) : "");
}

// Абзацы комментария: строки без пустых
const commentLines = (text) => (text ? String(text).split(/\n+/).map((line) => line.trim()).filter(Boolean) : []);

// Есть ли в документе разделы инструкции (FR-10)
const hasChapters = (doc) => doc.sections.some((section) => section.chapter);

// Верхний колонтитул с номером страницы по центру (как «КИСУСС_колонтитул верхний»)
function headerXml() {
  return XML_HEADER + `<w:hdr xmlns:w="${NS_W}"><w:p><w:pPr><w:pStyle w:val="Header"/></w:pPr>` +
    `<w:fldSimple w:instr=" PAGE ">${textRun("1")}</w:fldSimple></w:p></w:hdr>`;
}

function documentXml(doc, styles) {
  const page = pageGeometry(styles);
  const body = [];
  body.push(paragraph("Title", textRun(doc.title)));
  if (doc.meta) body.push(paragraph("DocMeta", textRun(doc.meta)));

  // Заголовок и текст шага держатся на одной странице со скриншотом, скриншот — с подписью (keepNext)
  const keepNext = "<w:keepNext/>";
  const numberProps = `<w:b/><w:color w:val="${styles.colors.stepNumber}"/>`;
  // Разделы — заголовки первого уровня, шаги — второго; без разделов шаги — первого уровня, как раньше
  const bySection = hasChapters(doc);
  const stepHeading = bySection ? "Heading2" : "Heading1";
  let imageIndex = 0;
  for (const section of doc.sections) {
    if (section.chapter) body.push(paragraph("Heading1", textRun(`${section.chapter.number} ${section.chapter.title}`)));
    body.push(paragraph(stepHeading, textRun(section.heading)));
    const withImage = section.image ? keepNext : "";
    for (const item of section.items) {
      const label = item.label ? textRun(item.label + " ", numberProps) : "";
      body.push(paragraph("StepText", label + textRun(item.text), withImage));
      for (const line of commentLines(item.comment)) body.push(paragraph("StepComment", textRun(line), withImage));
    }
    if (section.image) {
      imageIndex += 1;
      const extent = imageExtent(section.image, styles);
      const caption = styles.image.captions && section.caption;
      body.push(paragraph("StepImage", drawing(extent, `rIdImage${imageIndex}`, imageIndex, styles), caption ? keepNext : ""));
      if (caption) body.push(paragraph("Caption", captionContent(caption, bySection)));
      // Текст к скриншоту — с нового абзаца после подписи, оформлен как основной текст
      for (const line of commentLines(section.figureText)) body.push(paragraph("FigureText", textRun(line)));
    }
  }

  const m = page.margins;
  const headerRef = styles.header.pageNumbers ? '<w:headerReference w:type="default" r:id="rIdHeader1"/>' : "";
  const sectPr = `<w:sectPr>${headerRef}<w:pgSz w:w="${page.width}" w:h="${page.height}"` +
    (styles.page.orientation === "landscape" ? ' w:orient="landscape"' : "") + "/>" +
    `<w:pgMar w:top="${m.top}" w:right="${m.right}" w:bottom="${m.bottom}" w:left="${m.left}" w:header="709" w:footer="709" w:gutter="0"/>` +
    "</w:sectPr>";

  return XML_HEADER +
    `<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}">` +
    `<w:body>${body.join("")}${sectPr}</w:body></w:document>`;
}

// Стили повторяют шаблон: Normal ≈ «КИСУСС_текст основной», Title ≈ «КИСУСС_заголовок без номера»,
// заголовок раздела ≈ «КИСУСС_заголовок 1ур», заголовок шага ≈ «КИСУСС_заголовок 2ур»,
// StepImage ≈ «КИСУСС_рисунок положение», Caption ≈ «КИСУСС_рисунок название»,
// Header ≈ «КИСУСС_колонтитул верхний». StepComment — комментарий к шагу (как основной текст),
// FigureText — текст к скриншоту после подписи (как основной текст). С разделами Heading1 — раздел, Heading2 — шаг;
// без разделов Heading1 — шаг
function stylesXml(styles, bySection = false) {
  const { fonts, sizesPt, colors, spacing, paragraph: para } = styles;
  const fontsXml = (font) => `<w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}" w:cs="${escapeXml(font)}" w:eastAsia="${escapeXml(font)}"/>`;
  const size = (pt) => `<w:sz w:val="${ptToHalfPoints(pt)}"/><w:szCs w:val="${ptToHalfPoints(pt)}"/>`;
  const line = Math.round(spacing.lineSpacing * 240);
  const noIndent = '<w:ind w:firstLine="0"/>';
  const centered = `${noIndent}<w:jc w:val="center"/>`;
  const stepHeadingStyle = (id, name, level) => style(id, name,
    `<w:keepNext/><w:spacing w:before="${ptToTwips(spacing.beforeHeadingPt)}" w:after="${ptToTwips(spacing.afterParagraphPt)}"/><w:outlineLvl w:val="${level}"/>`,
    `${fontsXml(fonts.headings)}<w:b/><w:color w:val="${colors.heading}"/>${size(sizesPt.heading)}`);
  const style = (id, name, pPr, rPr) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>` +
    `<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;

  return XML_HEADER + `<w:styles xmlns:w="${NS_W}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>${fontsXml(fonts.body)}` +
    `<w:color w:val="${colors.body}"/>${size(sizesPt.body)}` +
    `<w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="${ptToTwips(spacing.afterParagraphPt)}" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
    `</w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/>` +
    `<w:pPr><w:ind w:firstLine="${mmToTwips(para.firstLineIndentMm)}"/><w:jc w:val="${ALIGN_WORD[para.align]}"/></w:pPr></w:style>` +
    style("Title", "Title", `<w:keepNext/><w:spacing w:after="${ptToTwips(6)}"/>${noIndent}<w:jc w:val="${ALIGN_WORD[styles.title.align]}"/>`,
      `${fontsXml(fonts.headings)}<w:b/><w:color w:val="${colors.title}"/>${size(sizesPt.title)}`) +
    style("DocMeta", "Document Meta", `<w:spacing w:after="${ptToTwips(12)}"/>${noIndent}<w:jc w:val="${ALIGN_WORD[styles.title.align]}"/>`,
      `<w:color w:val="${colors.meta}"/>${size(sizesPt.meta)}`) +
    (bySection
      ? style("Heading1", "heading 1",
        `<w:keepNext/><w:spacing w:before="${ptToTwips(spacing.beforeSectionPt)}" w:after="${ptToTwips(spacing.afterParagraphPt)}"/><w:outlineLvl w:val="0"/>`,
        `${fontsXml(fonts.headings)}<w:b/><w:color w:val="${colors.heading}"/>${size(sizesPt.section)}`) +
        stepHeadingStyle("Heading2", "heading 2", 1)
      : stepHeadingStyle("Heading1", "heading 1", 0)) +
    style("StepText", "Step Text", "", "") +
    style("StepComment", "Step Comment", "", "") +
    style("StepImage", "Step Image",
      `<w:spacing w:before="${ptToTwips(spacing.beforeImagePt)}" w:after="${ptToTwips(spacing.afterImagePt)}"/>${centered}`, "<w:noProof/>") +
    style("FigureText", "Figure Text", "", "") +
    style("Caption", "caption", `<w:spacing w:after="${ptToTwips(spacing.afterCaptionPt)}"/>${centered}`, size(sizesPt.caption)) +
    style("Header", "header", `<w:spacing w:after="0"/>${centered}`, size(sizesPt.pageNumber)) +
    `</w:styles>`;
}

function coreXml(doc, date) {
  const iso = date.toISOString().replace(/\.\d{3}Z$/, "Z");
  return XML_HEADER +
    '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" ' +
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${escapeXml(doc.title)}</dc:title><dc:language>ru-RU</dc:language>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${iso}</dcterms:created>` +
    "</cp:coreProperties>";
}

// Все файлы пакета .docx: [{ name, data }]
function docxFiles(doc, styles, date = new Date()) {
  const images = doc.sections.filter((section) => section.image).map((section) => section.image);
  const header = styles.header.pageNumbers;
  const contentTypes = XML_HEADER +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    (header ? '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' : "") +
    "</Types>";
  const rootRels = XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    "</Relationships>";
  const documentRels = XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    (header ? '<Relationship Id="rIdHeader1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' : "") +
    images.map((_, i) =>
      `<Relationship Id="rIdImage${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.jpeg"/>`).join("") +
    "</Relationships>";

  return [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "docProps/core.xml", data: coreXml(doc, date) },
    { name: "word/document.xml", data: documentXml(doc, styles) },
    { name: "word/styles.xml", data: stylesXml(styles, hasChapters(doc)) },
    ...(header ? [{ name: "word/header1.xml", data: headerXml() }] : []),
    { name: "word/_rels/document.xml.rels", data: documentRels },
    ...images.map((image, i) => ({ name: `word/media/image${i + 1}.jpeg`, data: image.bytes })),
  ];
}

// Готовый .docx в байтах
function buildDocx(doc, styles, date = new Date()) {
  return createZip(docxFiles(doc, styles, date), date);
}
