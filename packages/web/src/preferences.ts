import { currentLanguage, LANGUAGE_KEY, translateStatic } from "./i18n/index.ts";

export type Appearance = "system" | "dark" | "light";
export type Accent = "blue" | "teal" | "violet";
const APPEARANCE_KEY = "cifeditor-appearance";
const ACCENT_KEY = "cifeditor-accent";

function readPreference<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const value = localStorage.getItem(key) as T;
    return allowed.includes(value) ? value : fallback;
  } catch { return fallback; }
}

function remember(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Preferences still work for this page. */ }
}

export function resolvedAppearance(appearance: Appearance, prefersLight: boolean): "dark" | "light" {
  return appearance === "system" ? (prefersLight ? "light" : "dark") : appearance;
}

export function languageReloadUrl(href: string, language: string, sessionId: string | null): string {
  const url = new URL(href);
  url.searchParams.set("lang", language);
  if (sessionId) {
    url.searchParams.set("session", sessionId);
    // An example deep link must not reopen the original instead of our edits.
    url.searchParams.delete("example");
  }
  return url.href;
}

export function initializePreferences(getSessionId: () => string | null): void {
  document.documentElement.lang = currentLanguage();
  translateStatic();
  const language = document.getElementById("ui-language") as HTMLSelectElement;
  const appearance = document.getElementById("ui-appearance") as HTMLSelectElement;
  const accent = document.getElementById("ui-accent") as HTMLSelectElement;
  const media = matchMedia("(prefers-color-scheme: light)");
  language.value = currentLanguage();
  appearance.value = readPreference(APPEARANCE_KEY, ["system", "dark", "light"], "dark");
  accent.value = readPreference(ACCENT_KEY, ["blue", "teal", "violet"], "blue");
  const apply = (): void => {
    const theme = resolvedAppearance(appearance.value as Appearance, media.matches);
    document.documentElement.dataset.uiTheme = theme;
    document.documentElement.dataset.accent = accent.value;
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "light" ? "#f6f7f9" : "#202124");
  };
  appearance.addEventListener("change", () => { remember(APPEARANCE_KEY, appearance.value); apply(); });
  accent.addEventListener("change", () => { remember(ACCENT_KEY, accent.value); apply(); });
  media.addEventListener("change", apply);
  language.addEventListener("change", () => {
    remember(LANGUAGE_KEY, language.value);
    // Documents and applied mutations live in the existing server session. Reload
    // consistently relabels every controller without resetting chemistry or Undo.
    location.replace(languageReloadUrl(location.href, language.value, getSessionId()));
  });
  apply();
}
