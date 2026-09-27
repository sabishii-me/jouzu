import type { Theme } from "@earendil-works/pi-coding-agent";
import { detectTerminalColorMode, renderTerminalRgb, type TerminalColorMode } from "./color.js";

export type SessionUiStyleRole =
	| "prompt.border"
	| "prompt.surface"
	| "session.hint.text"
	| "session.hint.muted"
	| "session.hint.accent"
	| "session.hint.success"
	| "session.hint.warning"
	| "session.hint.error"
	| "session.activity"
	| "session.activity.idle"
	| "session.provider"
	| "session.model"
	| "status.text"
	| "status.muted"
	| "status.accent"
	| "status.success"
	| "status.warning"
	| "status.error"
	| "status.workspace"
	| "status.git.branch"
	| "status.git.changes"
	| "status.runtime.default"
	| "status.runtime.node"
	| "status.runtime.deno"
	| "status.runtime.bun"
	| "status.runtime.python"
	| "status.runtime.java"
	| "status.runtime.rust"
	| "status.runtime.ruby"
	| "status.runtime.go"
	| "status.runtime.lua"
	| "status.runtime.php"
	| "status.context.normal"
	| "status.context.warning"
	| "status.context.error"
	| "status.tokens"
	| "status.separator"
	| "status.health"
	| "status.unknown"
	| "palette.border"
	| "palette.title"
	| "palette.count"
	| "palette.marker"
	| "palette.identity"
	| "palette.identity.selected"
	| "palette.favorite"
	| "palette.default"
	| "palette.unavailable"
	| "palette.context.small"
	| "palette.section"
	| "palette.section.current"
	| "palette.detail"
	| "palette.tab.active"
	| "palette.tab.inactive"
	| "palette.heading"
	| "palette.rule"
	| "palette.key"
	| "palette.label"
	| "palette.value"
	| "palette.status.ready"
	| "palette.status.attention"
	| "palette.status.off"
	| "palette.empty"
	| "palette.message.error"
	| "palette.message.warning"
	| "palette.message.info"
	| "palette.hint";

type ThemeColor = Parameters<Theme["fg"]>[0];
type ThemeBackground = Parameters<Theme["bg"]>[0];

/**
 * `theme` and `rgb` name a foreground color; `themeBackground` names a background. A role declares
 * which plane it paints, so a renderer never has to know whether its value is text or a filled row.
 */
export type SessionUiColor =
	| Readonly<{ source: "theme"; value: ThemeColor }>
	| Readonly<{ source: "rgb"; red: number; green: number; blue: number }>
	| Readonly<{ source: "themeBackground"; value: ThemeBackground }>;

export type SessionUiStyleScheme = Readonly<Record<SessionUiStyleRole, SessionUiColor>>;

const theme = (value: ThemeColor): SessionUiColor => Object.freeze({ source: "theme", value });
const rgb = (red: number, green: number, blue: number): SessionUiColor =>
	Object.freeze({ source: "rgb", red, green, blue });
const themeBackground = (value: ThemeBackground): SessionUiColor => Object.freeze({ source: "themeBackground", value });

/** Jouzu brand accents for the Palette, behind one capability policy. */
const BRAND_BLUE = rgb(103, 232, 249);
const BRAND_PINK = rgb(244, 114, 182);

/** Jouzu-owned semantic roles with defaults matched to the retained Session UI baseline. */
export const DEFAULT_SESSION_UI_STYLE_SCHEME: SessionUiStyleScheme = Object.freeze({
	"prompt.border": theme("borderMuted"),
	"prompt.surface": themeBackground("userMessageBg"),
	"session.hint.text": theme("text"),
	"session.hint.muted": theme("muted"),
	"session.hint.accent": theme("accent"),
	"session.hint.success": theme("success"),
	"session.hint.warning": theme("warning"),
	"session.hint.error": theme("error"),
	"session.activity": theme("accent"),
	"session.activity.idle": theme("dim"),
	"session.provider": theme("dim"),
	"session.model": theme("mdCode"),
	"status.text": theme("text"),
	"status.muted": theme("muted"),
	"status.accent": theme("accent"),
	"status.success": theme("success"),
	"status.warning": theme("warning"),
	"status.error": theme("error"),
	"status.workspace": rgb(215, 215, 255),
	"status.git.branch": theme("syntaxKeyword"),
	"status.git.changes": theme("error"),
	"status.runtime.default": theme("text"),
	"status.runtime.node": theme("success"),
	"status.runtime.deno": theme("syntaxType"),
	"status.runtime.bun": theme("warning"),
	"status.runtime.python": theme("warning"),
	"status.runtime.java": theme("warning"),
	"status.runtime.rust": theme("error"),
	"status.runtime.ruby": theme("error"),
	"status.runtime.go": theme("syntaxType"),
	"status.runtime.lua": theme("accent"),
	"status.runtime.php": theme("accent"),
	"status.context.normal": rgb(250, 204, 21),
	"status.context.warning": theme("warning"),
	"status.context.error": theme("error"),
	"status.tokens": rgb(255, 175, 215),
	"status.separator": theme("borderMuted"),
	"status.health": theme("error"),
	"status.unknown": theme("warning"),
	"palette.border": theme("borderAccent"),
	"palette.title": theme("accent"),
	"palette.count": theme("muted"),
	"palette.marker": BRAND_BLUE,
	"palette.identity": theme("text"),
	"palette.identity.selected": BRAND_BLUE,
	"palette.favorite": theme("warning"),
	"palette.default": theme("success"),
	"palette.unavailable": theme("error"),
	"palette.context.small": theme("warning"),
	"palette.section": theme("muted"),
	"palette.section.current": BRAND_PINK,
	"palette.detail": BRAND_BLUE,
	"palette.tab.active": theme("accent"),
	"palette.tab.inactive": theme("muted"),
	"palette.heading": BRAND_BLUE,
	"palette.rule": theme("borderMuted"),
	"palette.key": theme("accent"),
	"palette.label": theme("muted"),
	"palette.value": theme("text"),
	"palette.status.ready": theme("success"),
	"palette.status.attention": theme("warning"),
	"palette.status.off": theme("dim"),
	"palette.empty": theme("muted"),
	"palette.message.error": theme("error"),
	"palette.message.warning": theme("warning"),
	"palette.message.info": theme("muted"),
	"palette.hint": theme("dim"),
});

export interface SessionUiStyles {
	readonly scheme: SessionUiStyleScheme;
	/**
	 * Style a value with the role's color. A background role fills the whole value, so the value
	 * must be one complete row: the fill is restored after any reset the row already contains.
	 */
	apply(role: SessionUiStyleRole, value: string): string;
}

export interface SessionUiStyleOptions {
	scheme?: SessionUiStyleScheme;
	colorEnabled?: boolean;
	colorMode?: TerminalColorMode;
	colorDepth?: number;
	stdoutIsTTY?: boolean;
	env?: NodeJS.ProcessEnv;
}

/** The theme a session UI can style from. Pi themes always carry `bg`; test doubles may not. */
export type SessionUiTheme = Pick<Theme, "fg"> & Partial<Pick<Theme, "bg" | "getBgAnsi">>;

function themeSupportsColor(themeValue: Pick<Theme, "fg">): boolean {
	const probe = "jouzu-color-probe";
	return themeValue.fg("accent", probe) !== probe;
}

/** The opening sequence for a theme background, or undefined when the theme cannot supply one. */
function themeBackgroundAnsi(themeValue: SessionUiTheme, color: ThemeBackground): string | undefined {
	const read = themeValue.getBgAnsi;
	if (typeof read !== "function") return undefined;
	return read.call(themeValue, color);
}

/**
 * Fill a row with a background color. The editor draws its cursor as reverse video followed by a full
 * reset, which would end the fill part-way along the row, so the fill is restored after every reset.
 */
function fillBackground(value: string, ansi: string | undefined): string {
	if (ansi === undefined) return value;
	return `${ansi}${value.split("\u001b[0m").join(`\u001b[0m${ansi}`)}\u001b[49m`;
}

export function createSessionUiStyles(
	themeValue: SessionUiTheme,
	options: SessionUiStyleOptions = {},
): SessionUiStyles {
	const env = options.env ?? process.env;
	const colorEnabled =
		options.colorEnabled ?? (env.NO_COLOR === undefined && env.TERM !== "dumb" && themeSupportsColor(themeValue));
	const detectedMode = detectTerminalColorMode({
		env,
		...(options.colorDepth !== undefined ? { colorDepth: options.colorDepth } : {}),
		...(options.stdoutIsTTY !== undefined ? { stdoutIsTTY: options.stdoutIsTTY } : {}),
	});
	const colorMode =
		options.colorMode ?? (options.colorEnabled === true && detectedMode === "none" ? "truecolor" : detectedMode);
	const scheme = options.scheme ?? DEFAULT_SESSION_UI_STYLE_SCHEME;
	return Object.freeze({
		scheme,
		apply(role: SessionUiStyleRole, value: string): string {
			if (!colorEnabled || value.length === 0) return value;
			const color = scheme[role];
			if (color.source === "theme") return themeValue.fg(color.value, value);
			if (color.source === "themeBackground")
				return fillBackground(value, themeBackgroundAnsi(themeValue, color.value));
			return renderTerminalRgb(value, color, colorMode);
		},
	});
}
