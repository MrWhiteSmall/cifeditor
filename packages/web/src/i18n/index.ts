import { zhCN } from "./zh-CN.ts";

export type Language = "zh-CN" | "en";
export const LANGUAGE_KEY = "cifeditor-language";

export function readLanguage(storage?: Pick<Storage, "getItem">, browserLanguage = "zh-CN"): Language {
  try {
    const value = storage?.getItem(LANGUAGE_KEY);
    if (value === "zh-CN" || value === "en") return value;
  } catch { /* Storage may be unavailable in an embedded editor. */ }
  return browserLanguage.toLowerCase().startsWith("zh") ? "zh-CN" : "en";
}

function initialLanguage(): Language {
  if (typeof navigator === "undefined") return "en";
  try { return readLanguage(localStorage, navigator.language); }
  catch { return readLanguage(undefined, navigator.language); }
}
let language: Language = initialLanguage();
if (typeof location !== "undefined") {
  const requested = new URLSearchParams(location.search).get("lang");
  if (requested === "zh-CN" || requested === "en") language = requested;
}

export function setLanguage(value: Language): void { language = value; }
export function currentLanguage(): Language { return language; }

/** Positional placeholders preserve scientific values without translating them. */
export function t(message: string, values: readonly unknown[] = []): string {
  const translated = language === "zh-CN" && Object.hasOwn(zhCN, message) ? zhCN[message] : message;
  return translated.replace(/\{(\d+)\}/g, (placeholder, index: string) =>
    Number(index) < values.length ? String(values[Number(index)]) : placeholder);
}

/** Explicit markers keep user data, query syntax and input values untouched. */
export function translateStatic(root: ParentNode = document): void {
  for (const element of root.querySelectorAll<HTMLElement>("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n!);
  }
  for (const attribute of ["aria-label", "placeholder", "title"]) {
    for (const element of root.querySelectorAll<HTMLElement>(`[data-i18n-${attribute}]`)) {
      element.setAttribute(attribute, t(element.getAttribute(`data-i18n-${attribute}`)!));
    }
  }
}
