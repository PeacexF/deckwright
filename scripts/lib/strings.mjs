// The few words the library itself puts on slides. Everything else comes from the deck script.
// Picked by meta.language; any of them can be overridden with meta.strings.

const PACKS = {
  en: {
    sources: "Sources",
    credits: "Image credits",
    thanks: "Thank you",
    conclusions: "Conclusions",
    photo: "Photo",
    noAuthor: "author not stated",
    noLicense: "licence not stated",
  },
  ru: {
    sources: "Источники",
    credits: "Иллюстрации",
    thanks: "Спасибо за внимание!",
    conclusions: "Выводы",
    photo: "Фото",
    noAuthor: "автор не указан",
    noLicense: "лицензия не указана",
  },
};

export function strings(language = "en-US", overrides = {}) {
  const base = PACKS[String(language).slice(0, 2).toLowerCase()] ?? PACKS.en;
  return { ...base, ...overrides };
}
