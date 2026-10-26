import type { ITheme } from "@xterm/xterm";
import type { ThemeId } from "../api";

export type { ThemeId };
export const THEME_ORDER: ThemeId[] = ["github-dark", "nord", "one-dark", "dracula", "tokyo-night"];
export const THEME_LABEL: Record<ThemeId, string> = {
  "github-dark": "GitHub Dark", nord: "Nord", "one-dark": "Atom One Dark", dracula: "Dracula", "tokyo-night": "Tokyo Night",
};

export function nextTheme(id: ThemeId): ThemeId {
  return THEME_ORDER[(THEME_ORDER.indexOf(id) + 1) % THEME_ORDER.length];
}

const known = (id?: string): id is ThemeId => THEME_ORDER.includes(id as ThemeId);

// Projects and settings saved by an earlier version can name a theme that has since gone.
export function themeFor(project?: { theme?: ThemeId }, settings?: { defaultTheme?: ThemeId }): ThemeId {
  if (known(project?.theme)) return project.theme;
  if (known(settings?.defaultTheme)) return settings.defaultTheme;
  return "github-dark";
}

type Palette = Required<Pick<ITheme,
  "background" | "foreground" | "cursor" | "cursorAccent" | "selectionBackground"
  | "black" | "red" | "green" | "yellow" | "blue" | "magenta" | "cyan" | "white"
  | "brightBlack" | "brightRed" | "brightGreen" | "brightYellow" | "brightBlue" | "brightMagenta" | "brightCyan" | "brightWhite">>;

// Agent CLIs colour their own output, so each theme maps all 16 ANSI colours into its own palette.
const PALETTES: Record<ThemeId, Palette> = {
  "github-dark": {
    background: "#0d1117", foreground: "#c9d1d9", cursor: "#58a6ff", cursorAccent: "#0d1117", selectionBackground: "rgba(56,139,253,.35)",
    black: "#484f58", red: "#ff7b72", green: "#3fb950", yellow: "#d29922", blue: "#58a6ff", magenta: "#bc8cff", cyan: "#39c5cf", white: "#b1bac4",
    brightBlack: "#6e7681", brightRed: "#ffa198", brightGreen: "#56d364", brightYellow: "#e3b341", brightBlue: "#79c0ff", brightMagenta: "#d2a8ff", brightCyan: "#56d4dd", brightWhite: "#f0f6fc",
  },
  nord: {
    background: "#2e3440", foreground: "#d8dee9", cursor: "#d8dee9", cursorAccent: "#2e3440", selectionBackground: "#434c5e",
    black: "#3b4252", red: "#bf616a", green: "#a3be8c", yellow: "#ebcb8b", blue: "#81a1c1", magenta: "#b48ead", cyan: "#88c0d0", white: "#e5e9f0",
    brightBlack: "#616e88", brightRed: "#bf616a", brightGreen: "#a3be8c", brightYellow: "#ebcb8b", brightBlue: "#81a1c1", brightMagenta: "#b48ead", brightCyan: "#8fbcbb", brightWhite: "#eceff4",
  },
  "one-dark": {
    background: "#282c34", foreground: "#abb2bf", cursor: "#528bff", cursorAccent: "#282c34", selectionBackground: "#3e4451",
    black: "#3f4451", red: "#e06c75", green: "#98c379", yellow: "#e5c07b", blue: "#61afef", magenta: "#c678dd", cyan: "#56b6c2", white: "#d7dae0",
    brightBlack: "#5c6370", brightRed: "#ff7b86", brightGreen: "#b1e18b", brightYellow: "#efd08b", brightBlue: "#67cdff", brightMagenta: "#e48bff", brightCyan: "#63d4e0", brightWhite: "#ffffff",
  },
  dracula: {
    background: "#282a36", foreground: "#f8f8f2", cursor: "#f8f8f2", cursorAccent: "#282a36", selectionBackground: "#44475a",
    black: "#21222c", red: "#ff5555", green: "#50fa7b", yellow: "#f1fa8c", blue: "#bd93f9", magenta: "#ff79c6", cyan: "#8be9fd", white: "#f8f8f2",
    brightBlack: "#6272a4", brightRed: "#ff6e6e", brightGreen: "#69ff94", brightYellow: "#ffffa5", brightBlue: "#d6acff", brightMagenta: "#ff92df", brightCyan: "#a4ffff", brightWhite: "#ffffff",
  },
  "tokyo-night": {
    background: "#1a1b26", foreground: "#a9b1d6", cursor: "#c0caf5", cursorAccent: "#1a1b26", selectionBackground: "#283457",
    black: "#15161e", red: "#f7768e", green: "#9ece6a", yellow: "#e0af68", blue: "#7aa2f7", magenta: "#bb9af7", cyan: "#7dcfff", white: "#a9b1d6",
    brightBlack: "#565f89", brightRed: "#ff899d", brightGreen: "#9fe044", brightYellow: "#faba4a", brightBlue: "#8db0ff", brightMagenta: "#c7a9ff", brightCyan: "#a4daff", brightWhite: "#c0caf5",
  },
};

export function xtermTheme(id: ThemeId): Palette {
  return PALETTES[id];
}
