// Шаблонное описание шага (FR-3). Тексты шаблонов хранятся в _locales/ru/messages.json.
// Описание собирается при показе, а не хранится в шаге: при правке шаблонов старые записи тоже обновятся.

// Источники подписи, которые понятны читателю инструкции. Атрибут name — техническое имя поля
// (например, "extra_field"), в тексте инструкции его не показываем.
const READABLE_LABEL_SOURCES = new Set([
  "aria-labelledby", "aria-label", "label", "text", "title", "placeholder", "alt",
]);

const MAX_VALUE_LENGTH = 100;

const BUTTON_INPUT_TYPES = new Set(["button", "submit", "reset"]);

function shorten(text) {
  const clean = String(text).replace(/\s+/g, " ").trim();
  return clean.length > MAX_VALUE_LENGTH ? clean.slice(0, MAX_VALUE_LENGTH - 1) + "…" : clean;
}

// Вид элемента для выбора шаблона клика
function clickKind(element = {}) {
  const { tag, inputType, role } = element;
  if (role === "link" || tag === "a") return "Link";
  if (role === "tab") return "Tab";
  if (role === "option" || role === "menuitem") return "Option";
  if (role === "button" || tag === "button" || (tag === "input" && BUTTON_INPUT_TYPES.has(inputType))) return "Button";
  return "Generic";
}

// Ключ шаблона в messages.json: "describe" + действие + вид элемента + ("" | "Enter") + ("" | "NoLabel").
// Возвращает текст и признак, что в описании использована подпись элемента (для оценки SQ-5).
function describeStep(step, t = (key, subs) => chrome.i18n.getMessage(key, subs)) {
  const label = READABLE_LABEL_SOURCES.has(step.labelSource) ? step.label : "";
  const hasLabel = Boolean(label);
  const suffix = hasLabel ? "" : "NoLabel";
  const value = step.value === null || step.value === undefined ? "" : shorten(step.value);

  let key;
  let substitutions;

  switch (step.type) {
    case "click":
      key = "describeClick" + clickKind(step.element);
      substitutions = [label];
      break;
    case "input":
      if (step.element?.inputType === "password") key = "describeInputPassword";
      else if (value === "") key = "describeInputClear";
      else key = "describeInput";
      if (step.pressedEnter) key += "Enter";
      substitutions = [label, value];
      break;
    case "select":
      key = "describeSelect";
      substitutions = [label, value];
      break;
    case "checkbox":
      key = step.value ? "describeCheckboxOn" : "describeCheckboxOff";
      substitutions = [label];
      break;
    case "radio":
      key = "describeRadio";
      substitutions = [label];
      break;
    default:
      return { text: t("describeUnknown"), usesLabel: false };
  }

  return { text: t(key + suffix, substitutions), usesLabel: hasLabel };
}
