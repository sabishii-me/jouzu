/**
 * Terminal measurement and color primitives for Jouzu-owned output.
 *
 * These re-export the two dependency-free Session UI modules rather than its barrel: the
 * barrel reaches Pi's agent runtime through the prompt frame, and `doctor` and `--help`
 * must keep working when that runtime cannot be loaded.
 */
export {
	detectTerminalColorMode,
	renderTerminalRgb,
	rgbToAnsi16,
	rgbToAnsi256,
	type TerminalColorMode,
} from "./session-ui/color.js";
export {
	fillTerminalColumns,
	fitTerminalText,
	padTerminalText,
	remainingTerminalColumns,
	renderTerminalFrameBorder,
	renderTerminalFrameRow,
	renderTerminalFrameTitle,
	sanitizeTerminalText,
	type TerminalFrameBorderOptions,
	type TerminalFrameOptions,
	type TerminalFrameTitleOptions,
	type TerminalTextAlignment,
	type TerminalTextStyle,
	terminalTextWidth,
} from "./session-ui/layout.js";
