// Light or dark. With nothing chosen the page follows the device (the CSS
// handles that with prefers-color-scheme, so there is no flash on load);
// a choice in the toggle is kept in localStorage and set on <html>.

export type Theme = "light" | "dark";

const KEY = "cista.theme";
const EVENT = "cista:theme";

export function parseTheme(value: string | null | undefined): Theme | null {
  return value === "light" || value === "dark" ? value : null;
}

/** The theme in force: the stored choice, else the device's setting. */
export function resolveTheme(stored: Theme | null, deviceDark: boolean): Theme {
  return stored ?? (deviceDark ? "dark" : "light");
}

function stored(): Theme | null {
  try {
    return parseTheme(localStorage.getItem(KEY));
  } catch {
    return null; // storage can be blocked; the device setting still applies
  }
}

function deviceDark(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

export function currentTheme(): Theme {
  return resolveTheme(stored(), deviceDark());
}

export function setTheme(theme: Theme): void {
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* the choice lasts for this page only */
  }
  document.documentElement.dataset.theme = theme;
  window.dispatchEvent(new Event(EVENT));
}

/** Run once before the first render, so a stored choice wins at once. */
export function applyStoredTheme(): void {
  const theme = stored();
  if (theme) document.documentElement.dataset.theme = theme;
}

export function onThemeChange(listener: () => void): () => void {
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-color-scheme: dark)") : null;
  window.addEventListener(EVENT, listener);
  media?.addEventListener("change", listener);
  return () => {
    window.removeEventListener(EVENT, listener);
    media?.removeEventListener("change", listener);
  };
}
