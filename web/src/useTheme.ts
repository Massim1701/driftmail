// driftmail — Theme-Auswahl (hell/dunkel/system laut design-tokens.json meta.themes)
import { useEffect, useState } from "react";

export type ThemeChoice = "hell" | "dunkel" | "system";
const STORAGE_KEY = "driftmail-theme";

function applyTheme(choice: ThemeChoice) {
  const root = document.documentElement;
  if (choice === "system") {
    root.removeAttribute("data-theme");
  } else {
    root.setAttribute("data-theme", choice);
  }
}

export function useTheme(): [ThemeChoice, (c: ThemeChoice) => void] {
  const [choice, setChoice] = useState<ThemeChoice>(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return stored === "hell" || stored === "dunkel" || stored === "system" ? stored : "system";
  });

  useEffect(() => {
    applyTheme(choice);
    window.localStorage.setItem(STORAGE_KEY, choice);
  }, [choice]);

  return [choice, setChoice];
}
