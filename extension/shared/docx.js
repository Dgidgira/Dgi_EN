// Сборка документа Word (.docx) для выгрузки инструкции (FR-8). Без сторонних библиотек:
// XML-части пишутся вручную и упаковываются в ZIP (shared/zip.js).
// Оформление (шрифты, размеры, цвета, поля, интервалы) — из extension/config/docx-styles.json,
// описание параметров — docs/docx-styles.md.
//
// Модель документа (её собирает страница просмотра):
// { title, meta, sections: [{ heading, items: [{ label, text }], image: { bytes, width, height } | null }] }
// label — номер шага («3.») или null; image.bytes — JPEG.

// --- Настройки оформления ---

const DEFAULT_DOCX_STYLES = {
  fonts: { body: "Calibri", headings: "Calibri" },
  sizesPt: { title: 20, heading: 13, body: 11, meta: 9 },
  colors: { title: "1F2937", heading: "1F2937", body: "1F2937", meta: "6B7280", stepNumber: "DC2626" },
  page: { size: "A4", orientation: "portrait", marginsMm: { top: 20, right: 15, bottom: 20, left: 20 } },
  spacing: { afterParagraphPt: 4, afterImagePt: 14, beforeHeadingPt: 12, lineSpacing: 1.15 },
  image: { maxWidthPercent: 100, border: true, borderColor: "D1D5DB" },
};

// Размеры страниц в twips (1/1440 дюйма)
const PAGE_SIZES_TWIPS = { A4: { width: 11906, height: 16838 }, Letter: { width: 12240, height: 15840 } };

// Проверки значений: неверное значение заменяется значением по умолчанию с предупреждением
const isFont = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 64;
const isColor = (v) => typeof v === "string" && /^[0-9A-Fa-f]{6}$/.test(v);
const inRange = (min, max) => (v) => typeof v === "number" && v >= min && v <= max;

const DOCX_STYLE_RULES = {
  fonts: { body: isFont, headings: isFont },
  sizesPt: { title: inRange(6, 72), heading: inRange(6, 72), body: inRange(6, 72), meta: inRange(6, 72) },
  colors: { title: isColor, heading: isColor, body: isColor, meta: isColor, stepNumber: isColor },
  page: {
    size: (v) => v in PAGE_SIZES_TWIPS,
    orientation: (v) => v === "portrait" || v === "landscape",
    marginsMm: { top: inRange(0, 100), right: inRange(0, 100), bottom: inRange(0, 100), left: inRange(0, 100) },
  },
  spacing: {
    afterParagraphPt: inRange(0, 72), afterImagePt: inRange(0, 72), beforeHeadingPt: inRange(0, 72), lineSpacing: inRange(0.5, 3),
  },
  image: { maxWidthPercent: inRange(10, 100), border: (v) => typeof v === "boolean", borderColor: isColor },
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

function documentXml(doc, styles) {
  const page = pageGeometry(styles);
  const body = [];
  body.push(paragraph("Title", textRun(doc.title)));
  if (doc.meta) body.push(paragraph("DocMeta", textRun(doc.meta)));

  // Заголовок и текст шага держатся на одной странице со скриншотом (keepNext)
  const keepNext = "<w:keepNext/>";
  const numberProps = `<w:b/><w:color w:val="${styles.colors.stepNumber}"/>`;
  let imageIndex = 0;
  for (const section of doc.sections) {
    body.push(paragraph("Heading1", textRun(section.heading)));
    for (const item of section.items) {
      const label = item.label ? textRun(item.label + " ", numberProps) : "";
      body.push(paragraph("StepText", label + textRun(item.text), section.image ? keepNext : ""));
    }
    if (section.image) {
      imageIndex += 1;
      const extent = imageExtent(section.image, styles);
      body.push(paragraph("StepImage", drawing(extent, `rIdImage${imageIndex}`, imageIndex, styles)));
    }
  }

  const m = page.margins;
  const sectPr = `<w:sectPr><w:pgSz w:w="${page.width}" w:h="${page.height}"` +
    (styles.page.orientation === "landscape" ? ' w:orient="landscape"' : "") + "/>" +
    `<w:pgMar w:top="${m.top}" w:right="${m.right}" w:bottom="${m.bottom}" w:left="${m.left}" w:header="709" w:footer="709" w:gutter="0"/>` +
    "</w:sectPr>";

  return XML_HEADER +
    `<w:document xmlns:w="${NS_W}" xmlns:r="${NS_R}" xmlns:wp="${NS_WP}" xmlns:a="${NS_A}" xmlns:pic="${NS_PIC}">` +
    `<w:body>${body.join("")}${sectPr}</w:body></w:document>`;
}

function stylesXml(styles) {
  const { fonts, sizesPt, colors, spacing } = styles;
  const fontsXml = (font) => `<w:rFonts w:ascii="${escapeXml(font)}" w:hAnsi="${escapeXml(font)}" w:cs="${escapeXml(font)}" w:eastAsia="${escapeXml(font)}"/>`;
  const line = Math.round(spacing.lineSpacing * 240);
  const style = (id, name, pPr, rPr) =>
    `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:qFormat/>` +
    `<w:pPr>${pPr}</w:pPr><w:rPr>${rPr}</w:rPr></w:style>`;

  return XML_HEADER + `<w:styles xmlns:w="${NS_W}">` +
    `<w:docDefaults><w:rPrDefault><w:rPr>${fontsXml(fonts.body)}` +
    `<w:color w:val="${colors.body}"/><w:sz w:val="${ptToHalfPoints(sizesPt.body)}"/><w:szCs w:val="${ptToHalfPoints(sizesPt.body)}"/>` +
    `<w:lang w:val="ru-RU"/></w:rPr></w:rPrDefault>` +
    `<w:pPrDefault><w:pPr><w:spacing w:after="${ptToTwips(spacing.afterParagraphPt)}" w:line="${line}" w:lineRule="auto"/></w:pPr></w:pPrDefault>` +
    `</w:docDefaults>` +
    `<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>` +
    style("Title", "Title", `<w:spacing w:after="${ptToTwips(6)}"/>`,
      `${fontsXml(fonts.headings)}<w:b/><w:color w:val="${colors.title}"/><w:sz w:val="${ptToHalfPoints(sizesPt.title)}"/>`) +
    style("DocMeta", "Document Meta", `<w:spacing w:after="${ptToTwips(12)}"/>`,
      `<w:color w:val="${colors.meta}"/><w:sz w:val="${ptToHalfPoints(sizesPt.meta)}"/>`) +
    style("Heading1", "heading 1",
      `<w:keepNext/><w:spacing w:before="${ptToTwips(spacing.beforeHeadingPt)}" w:after="${ptToTwips(spacing.afterParagraphPt)}"/><w:outlineLvl w:val="0"/>`,
      `${fontsXml(fonts.headings)}<w:b/><w:color w:val="${colors.heading}"/><w:sz w:val="${ptToHalfPoints(sizesPt.heading)}"/>`) +
    style("StepText", "Step Text", "", "") +
    style("StepImage", "Step Image", `<w:jc w:val="center"/><w:spacing w:after="${ptToTwips(spacing.afterImagePt)}"/>`, "") +
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
  const contentTypes = XML_HEADER +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Default Extension="jpeg" ContentType="image/jpeg"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    "</Types>";
  const rootRels = XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    "</Relationships>";
  const documentRels = XML_HEADER +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    images.map((_, i) =>
      `<Relationship Id="rIdImage${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image${i + 1}.jpeg"/>`).join("") +
    "</Relationships>";

  return [
    { name: "[Content_Types].xml", data: contentTypes },
    { name: "_rels/.rels", data: rootRels },
    { name: "docProps/core.xml", data: coreXml(doc, date) },
    { name: "word/document.xml", data: documentXml(doc, styles) },
    { name: "word/styles.xml", data: stylesXml(styles) },
    { name: "word/_rels/document.xml.rels", data: documentRels },
    ...images.map((image, i) => ({ name: `word/media/image${i + 1}.jpeg`, data: image.bytes })),
  ];
}

// Готовый .docx в байтах
function buildDocx(doc, styles, date = new Date()) {
  return createZip(docxFiles(doc, styles, date), date);
}
