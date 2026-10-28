import { useSyncExternalStore } from "react";

/**
 * Theme controller (Graphite & Signal, DESIGN.md §1).
 *
 * The preference lives in `localStorage["cp-theme"]` as "dark" | "light" | "system"
 * (default "dark"). The resolved theme is written to `<html data-theme>` so the
 * token sheet (styles/tokens.css) can switch; with "system" the OS
 * `prefers-color-scheme` decides and later OS changes are followed live.
 */

export type ThemePreference = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

export interface ThemeState {
  preference: ThemePreference;
  resolved: ResolvedTheme;
}

export const THEME_STORAGE_KEY = "cp-theme";
export const DEFAULT_THEME: ThemePreference = "dark";
/** Order the TopBar toggle walks through. */
export const THEME_CYCLE: ThemePreference[] = ["dark", "light", "system"];

const LIGHT_QUERY = "(prefers-color-scheme: light)";

function isPreference(value: unknown): value is ThemePreference {
  return value === "dark" || value === "light" || value === "system";
}

function readStoredPreference(): ThemePreference {
  try {
    const raw = globalThis.localStorage?.getItem(THEME_STORAGE_KEY);
    return isPreference(raw) ? raw : DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function writeStoredPreference(preference: ThemePreference): void {
  try {
    globalThis.localStorage?.setItem(THEME_STORAGE_KEY, preference);
  } catch {
    /* storage blocked: the choice still applies for this session */
  }
}

function lightMedia(): MediaQueryList | null {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(LIGHT_QUERY) : null;
}

export function resolveTheme(preference: ThemePreference): ResolvedTheme {
  if (preference !== "system") return preference;
  return lightMedia()?.matches ? "light" : "dark";
}

let state: ThemeState = { preference: DEFAULT_THEME, resolved: DEFAULT_THEME };
const listeners = new Set<() => void>();
let mediaBound = false;

function applyToDocument(resolved: ResolvedTheme): void {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.dataset.theme = resolved;
  root.style.colorScheme = resolved;
  document.querySelector('meta[name="color-scheme"]')?.setAttribute("content", resolved);
}

function commit(preference: ThemePreference): void {
  const next: ThemeState = { preference, resolved: resolveTheme(preference) };
  applyToDocument(next.resolved);
  if (next.preference === state.preference && next.resolved === state.resolved) return;
  state = next;
  for (const listener of listeners) listener();
}

function bindMedia(): void {
  if (mediaBound) return;
  const media = lightMedia();
  if (!media) return;
  mediaBound = true;
  media.addEventListener("change", () => {
    if (state.preference === "system") commit("system");
  });
}

/** Read the stored preference, apply it to <html> and start following the OS. Call once before the first render. */
export function initTheme(): ThemeState {
  bindMedia();
  commit(readStoredPreference());
  return state;
}

export function getTheme(): ThemeState {
  return state;
}

/** Persist and apply a theme preference. */
export function setTheme(preference: ThemePreference): void {
  bindMedia();
  writeStoredPreference(preference);
  commit(preference);
}

/** dark → light → system → dark … */
export function cycleTheme(): ThemePreference {
  const next = THEME_CYCLE[(THEME_CYCLE.indexOf(state.preference) + 1) % THEME_CYCLE.length]!;
  setTheme(next);
  return next;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Current preference + resolved theme, re-rendering on change (toggle or OS switch while on "system"). */
export function useTheme(): ThemeState & { setTheme: typeof setTheme; cycleTheme: typeof cycleTheme } {
  const current = useSyncExternalStore(subscribe, getTheme, getTheme);
  return { ...current, setTheme, cycleTheme };
}
