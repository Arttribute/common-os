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
  "--background": commonOsTheme.dark["--cos-bg"],
  "--foreground": commonOsTheme.dark["--cos-fg"],
  "--card": commonOsTheme.dark["--cos-card"],
  "--card-foreground": commonOsTheme.dark["--cos-fg"],
  "--popover": commonOsTheme.dark["--cos-card"],
  "--popover-foreground": commonOsTheme.dark["--cos-fg"],
  "--primary": commonOsTheme.dark["--cos-amber"],
  "--primary-foreground": "222 47% 7%",
  "--secondary": "220 35% 12%",
  "--secondary-foreground": commonOsTheme.dark["--cos-fg"],
  "--muted": "220 35% 11%",
  "--muted-foreground": commonOsTheme.dark["--cos-muted"],
  "--accent": "220 35% 14%",
  "--accent-foreground": commonOsTheme.dark["--cos-fg"],
  "--border": commonOsTheme.dark["--cos-border"],
  "--input": "0 0% 100% / 0.1",
  "--ring": commonOsTheme.dark["--cos-amber"],
  "--cos-radius": "8px",
} as ThemeVariables;
