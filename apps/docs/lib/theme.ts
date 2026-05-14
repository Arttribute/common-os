import type { CSSProperties } from "react";

type CssVariableName = `--${string}`;
type ThemeVariables = CSSProperties & Record<CssVariableName, string>;

export const commonOsTheme = {
  light: {
    "--cos-bg": "248 250 252",
    "--cos-fg": "15 23 42",
    "--cos-card": "255 255 255",
    "--cos-muted": "71 85 105",
    "--cos-border": "203 213 225",
    "--cos-amber": "217 119 6",
    "--cos-cyan": "8 145 178",
  },
  dark: {
    "--cos-bg": "6 11 20",
    "--cos-fg": "226 232 240",
    "--cos-card": "10 17 30",
    "--cos-muted": "148 163 184",
    "--cos-border": "51 65 85",
    "--cos-amber": "245 158 11",
    "--cos-cyan": "34 211 238",
  },
} as const satisfies Record<"light" | "dark", ThemeVariables>;

export const rootThemeVars = {
  ...commonOsTheme.light,
  "--cos-radius": "8px",
} as const satisfies ThemeVariables;
