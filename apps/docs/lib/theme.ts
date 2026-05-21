import type { CSSProperties } from "react";

type CssVariableName = `--${string}`;
type ThemeVariables = CSSProperties & Record<CssVariableName, string>;

export const commonOsTheme = {
  light: {
    "--cos-bg": "219 54% 5%",
    "--cos-fg": "214 32% 91%",
    "--cos-card": "221 45% 8%",
    "--cos-muted": "215 20% 55%",
    "--cos-border": "0 0% 100% / 0.08",
    "--cos-amber": "38 92% 50%",
    "--cos-cyan": "188 86% 53%",
  },
  dark: {
    "--cos-bg": "219 54% 5%",
    "--cos-fg": "214 32% 91%",
    "--cos-card": "221 45% 8%",
    "--cos-muted": "215 20% 55%",
    "--cos-border": "0 0% 100% / 0.08",
    "--cos-amber": "38 92% 50%",
    "--cos-cyan": "188 86% 53%",
  },
} as const satisfies Record<"light" | "dark", ThemeVariables>;

export const rootThemeVars = {
  ...commonOsTheme.dark,
  "--cos-radius": "8px",
} as ThemeVariables;
