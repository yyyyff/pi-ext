/**
 * pi-footer — Independent footer extension for Pi.
 *
 * Provides two-line footer with session info, context progress (Pac-Man),
 * project info (cwd/git/runtime), TPS tracking, and a Claude Code-style
 * prompt editor with ❯ marker.
 */

import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
	ExtensionAPI,
	ExtensionContext,
	Theme,
	ThemeColor,
} from "@earendil-works/pi-coding-agent";
import { CustomEditor, type KeybindingsManager } from "@earendil-works/pi-coding-agent";
import { type EditorTheme, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { execFile } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

// ══════════════════════════════════════════════════════════════════
// Git status
// ══════════════════════════════════════════════════════════════════

const execFileAsync = promisify(execFile);

type GitStatusSummary = {
	branch?: string;
	ahead: number;
	behind: number;
	stashed: boolean;
};

function emptyGitStatus(): GitStatusSummary {
	return { branch: undefined, ahead: 0, behind: 0, stashed: false };
}

function parseGitStatusPorcelain(stdoutText: string, hasStash: boolean): GitStatusSummary {
	const status = emptyGitStatus();
	status.stashed = hasStash;

	for (const line of stdoutText.split(/\r?\n/)) {
		if (!line) continue;
		if (line.startsWith("# branch.head ")) {
			const branch = line.slice("# branch.head ".length).trim();
			status.branch = branch && branch !== "(detached)" ? branch : undefined;
			continue;
		}
		if (line.startsWith("# branch.ab ")) {
			const match = line.match(/\+(\d+)\s+-(\d+)/);
			if (match) {
				status.ahead = Number(match[1] ?? 0);
				status.behind = Number(match[2] ?? 0);
			}
			continue;
		}
	}

	return status;
}

async function readGitStatus(cwd: string): Promise<GitStatusSummary> {
	try {
		const [{ stdout: statusStdout }, stashResult] = await Promise.all([
			execFileAsync("git", ["status", "--porcelain=2", "--branch"], { cwd }),
			execFileAsync("git", ["rev-parse", "--verify", "--quiet", "refs/stash"], { cwd }).catch(
				() => ({ stdout: "" }),
			),
		]);
		const stdoutText = typeof statusStdout === "string" ? statusStdout : String(statusStdout);
		const stashStdout =
			typeof stashResult.stdout === "string" ? stashResult.stdout : String(stashResult.stdout);
		return parseGitStatusPorcelain(stdoutText, stashStdout.trim().length > 0);
	} catch {
		return emptyGitStatus();
	}
}

// ══════════════════════════════════════════════════════════════════
// Runtime detection
// ══════════════════════════════════════════════════════════════════

const VERSION_TIMEOUT_MS = 2500;

type RuntimeInfo = {
	name: string;
	symbol: string;
	version?: string;
};

type RuntimeCandidate = {
	name: string;
	symbol: string;
	detect: (cwd: string, entries: string[]) => boolean;
	version: (cwd: string) => Promise<string | undefined>;
};

function hasAnyFile(cwd: string, names: string[]): boolean {
	return names.some((name) => existsSync(join(cwd, name)));
}

function hasLuaFile(entries: string[]): boolean {
	return entries.some((entry) => entry.endsWith(".lua"));
}

function hasAnyEntry(entries: string[], names: string[]): boolean {
	return names.some((name) => entries.includes(name));
}

async function runVersion(
	command: string,
	args: string[] = [],
	cwd?: string,
): Promise<string | undefined> {
	try {
		const { stdout, stderr } = await execFileAsync(command, args, {
			cwd,
			timeout: VERSION_TIMEOUT_MS,
		});
		const text =
			`${typeof stdout === "string" ? stdout : String(stdout)}\n${typeof stderr === "string" ? stderr : String(stderr)}`.trim();
		return text || undefined;
	} catch {
		return undefined;
	}
}

function prefixVersion(version: string | undefined): string | undefined {
	if (!version) return undefined;
	return version.startsWith("v") ? version : `v${version}`;
}

const runtimes: RuntimeCandidate[] = [
	{
		name: "bun",
		symbol: "\u{E76F}",
		detect: (cwd) => hasAnyFile(cwd, ["bun.lock", "bun.lockb"]),
		version: async () => prefixVersion(await runVersion("bun", ["--version"])),
	},
	{
		name: "deno",
		symbol: "\u{E7C0}",
		detect: (cwd) => hasAnyFile(cwd, ["deno.json", "deno.jsonc", "deno.lock"]),
		version: async () => {
			const output = await runVersion("deno", ["--version"]);
			const match = output?.match(/deno\s+([0-9][^\s]*)/i);
			return prefixVersion(match?.[1]);
		},
	},
	{
		name: "lua",
		symbol: "\u{E620}",
		detect: (cwd, entries) =>
			hasAnyFile(cwd, ["stylua.toml", ".stylua.toml", ".luarc.json", ".luarc.jsonc", "init.lua"]) ||
			hasAnyEntry(entries, ["lua"]) ||
			hasLuaFile(entries),
		version: async () => {
			const lua = await runVersion("lua", ["-v"]);
			const luaMatch = lua?.match(/Lua\s+([0-9][^\s]*)/i);
			if (luaMatch?.[1]) return prefixVersion(luaMatch[1]);
			const luajit = await runVersion("luajit", ["-v"]);
			const luajitMatch = luajit?.match(/LuaJIT\s+([0-9][^\s]*)/i);
			return prefixVersion(luajitMatch?.[1]);
		},
	},
	{
		name: "nodejs",
		symbol: "\u{E718}",
		detect: (cwd) => hasAnyFile(cwd, ["package.json", ".nvmrc", ".node-version"]),
		version: async () => prefixVersion(await runVersion("node", ["--version"])),
	},
	{
		name: "python",
		symbol: "\u{E235}",
		detect: (cwd) =>
			hasAnyFile(cwd, [
				"pyproject.toml",
				"requirements.txt",
				"setup.py",
				"setup.cfg",
				"Pipfile",
				".python-version",
			]),
		version: async () => {
			const python3 = await runVersion("python3", ["--version"]);
			const python3Match = python3?.match(/Python\s+([0-9][^\s]*)/i);
			if (python3Match?.[1]) return prefixVersion(python3Match[1]);
			const python = await runVersion("python", ["--version"]);
			const pythonMatch = python?.match(/Python\s+([0-9][^\s]*)/i);
			return prefixVersion(pythonMatch?.[1]);
		},
	},
	{
		name: "golang",
		symbol: "\u{E627}",
		detect: (cwd) => hasAnyFile(cwd, ["go.mod"]),
		version: async () => {
			const output = await runVersion("go", ["version"]);
			const match = output?.match(/go version go([0-9][^\s]*)/i);
			return prefixVersion(match?.[1]);
		},
	},
	{
		name: "rust",
		symbol: "\u{F1617}",
		detect: (cwd) => hasAnyFile(cwd, ["Cargo.toml"]),
		version: async () => {
			const output = await runVersion("rustc", ["--version"]);
			const match = output?.match(/rustc\s+([0-9][^\s]*)/i);
			return prefixVersion(match?.[1]);
		},
	},
	{
		name: "java",
		symbol: "\u{E256}",
		detect: (cwd) => hasAnyFile(cwd, ["pom.xml", "build.gradle", "build.gradle.kts"]),
		version: async () => {
			const output = await runVersion("java", ["-version"]);
			const quoted = output?.match(/"([0-9][^"]*)"/);
			if (quoted?.[1]) return prefixVersion(quoted[1]);
			const plain = output?.match(/version\s+([0-9][^\s]*)/i);
			return prefixVersion(plain?.[1]);
		},
	},
	{
		name: "ruby",
		symbol: "\u{E791}",
		detect: (cwd) => hasAnyFile(cwd, ["Gemfile", ".ruby-version"]),
		version: async () => {
			const output = await runVersion("ruby", ["--version"]);
			const match = output?.match(/ruby\s+([0-9][^\s]*)/i);
			return prefixVersion(match?.[1]);
		},
	},
	{
		name: "php",
		symbol: "\u{E608}",
		detect: (cwd) => hasAnyFile(cwd, ["composer.json"]),
		version: async () => {
			const output = await runVersion("php", ["--version"]);
			const match = output?.match(/PHP\s+([0-9][^\s]*)/i);
			return prefixVersion(match?.[1]);
		},
	},
];

function detectRuntime(cwd: string, entries: string[]): RuntimeCandidate | undefined {
	for (const runtime of runtimes) {
		if (runtime.detect(cwd, entries)) return runtime;
	}
	return undefined;
}

async function readRuntimeInfo(cwd: string): Promise<RuntimeInfo | undefined> {
	let entries: string[] = [];
	try {
		entries = readdirSync(cwd);
	} catch {
		entries = [];
	}

	const runtime = detectRuntime(cwd, entries);
	if (!runtime) return undefined;
	return {
		name: runtime.name,
		symbol: runtime.symbol,
		version: await runtime.version(cwd),
	};
}

// ══════════════════════════════════════════════════════════════════
// Footer state & formatting helpers
// ══════════════════════════════════════════════════════════════════

type FooterState = GitStatusSummary & {
	modelLabel: string;
	providerLabel: string;
	tokenLabel: string;
	tpsLabel: string;
	thinkingLevel: string | undefined;
	runtime?: RuntimeInfo;
};

type UsageTotals = {
	input: number;
	output: number;
};

function formatCount(value: number): string {
	if (value < 1000) return `${value}`;
	if (value < 10_000) return `${(value / 1000).toFixed(1)}k`;
	return `${Math.round(value / 1000)}k`;
}

function formatProviderLabel(provider: string | undefined): string {
	if (!provider) return "Unknown";

	const known: Record<string, string> = {
		anthropic: "Anthropic",
		gemini: "Google",
		google: "Google",
		ollama: "Ollama",
		openai: "OpenAI",
		"openai-codex": "OpenAI",
	};

	return (
		known[provider] ?? provider.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase())
	);
}

function getUsageTotals(ctx: ExtensionContext): UsageTotals {
	let input = 0;
	let output = 0;

	for (const entry of ctx.sessionManager.getBranch()) {
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const message = entry.message as AssistantMessage;
		input += message.usage?.input ?? 0;
		output += message.usage?.output ?? 0;
	}

	return { input, output };
}

function buildTokenLabel(totals: UsageTotals): string {
	return `↑${formatCount(totals.input)} ↓${formatCount(totals.output)}`;
}

function getRuntimeColorToken(runtime: RuntimeInfo | undefined): ThemeColor {
	switch (runtime?.name) {
		case "nodejs":
			return "success";
		case "deno":
			return "syntaxType";
		case "bun":
			return "warning";
		case "python":
		case "java":
			return "warning";
		case "rust":
		case "ruby":
			return "error";
		case "golang":
			return "syntaxType";
		case "lua":
		case "php":
			return "accent";
		default:
			return "text";
	}
}

function formatRuntimeSegment(
	theme: Pick<Theme, "fg">,
	runtime: RuntimeInfo | undefined,
): string {
	if (!runtime) return "";
	const label = runtime.version ? `${runtime.symbol} ${runtime.version}` : runtime.symbol;
	return `${theme.fg("text", "via")} ${theme.fg(getRuntimeColorToken(runtime), label)}`;
}

function formatCwdLabel(cwd: string, cwdIcon: string): string {
	const normalized = cwd.replace(/\\/g, "/").replace(/\/+$/, "");
	const parts = normalized.split("/").filter(Boolean);
	const last = parts[parts.length - 1] ?? cwd;
	return cwdIcon ? `${cwdIcon} ${last}` : last;
}

function getContextUsageColorToken(percent: number | null): "success" | "warning" | "error" {
	if (percent === null) return "success";
	if (percent >= 90) return "error";
	if (percent >= 70) return "warning";
	return "success";
}

// ══════════════════════════════════════════════════════════════════
// Pac-Man context progress bar (auto palette from theme)
// ══════════════════════════════════════════════════════════════════

type ThemeFgToken = Parameters<Theme["getFgAnsi"]>[0];
type ThemeBgToken = Parameters<Theme["getBgAnsi"]>[0];

type Rgb = {
	r: number;
	g: number;
	b: number;
};

type PacmanPalette = {
	bracket: string;
	eaten: string;
	pacman: string;
	success: string;
	warning: string;
	error: string;
};

type PacmanSatiety = "normal" | "full" | "stuffed";

type PacmanRenderState = {
	color: string;
	satiety: PacmanSatiety;
	bold: boolean;
};

/** Fallback palettes for when theme tokens can't be resolved. */
const FALLBACK_PALETTES = {
	dark: {
		bracket: "#6c7086",
		eaten: "#585b70",
		pacman: "#74c7ec",
		success: "#a6e3a1",
		warning: "#f9e2af",
		error: "#f38ba8",
	},
	light: {
		bracket: "#8c8fa1",
		eaten: "#acb0be",
		pacman: "#1e66f5",
		success: "#40a02b",
		warning: "#df8e1d",
		error: "#d20f39",
	},
} as const;

// ── Pre-compiled regexes for ANSI RGB parsing ──

const RE_FG_TRUECOLOR = /\x1b\[38;2;(\d+);(\d+);(\d+)m/;
const RE_FG_INDEXED = /\x1b\[38;5;(\d+)m/;
const RE_BG_TRUECOLOR = /\x1b\[48;2;(\d+);(\d+);(\d+)m/;
const RE_BG_INDEXED = /\x1b\[48;5;(\d+)m/;

const XTERM_CUBE_VALUES = [0, 95, 135, 175, 215, 255] as const;

function dimColored(text: string): string {
	return `\x1b[2m${text}\x1b[22m`;
}

function boldColored(text: string): string {
	return `\x1b[1m${text}\x1b[22m`;
}

function clampByte(value: number): number {
	return Math.max(0, Math.min(255, Math.round(value)));
}

function hexToRgb(hex: string): Rgb {
	const normalized = hex.slice(1);
	return {
		r: Number.parseInt(normalized.slice(0, 2), 16),
		g: Number.parseInt(normalized.slice(2, 4), 16),
		b: Number.parseInt(normalized.slice(4, 6), 16),
	};
}

function rgbToHex(rgb: Rgb): string {
	const toHex = (value: number) => clampByte(value).toString(16).padStart(2, "0");
	return `#${toHex(rgb.r)}${toHex(rgb.g)}${toHex(rgb.b)}`;
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
	return {
		r: clampByte(from.r + (to.r - from.r) * amount),
		g: clampByte(from.g + (to.g - from.g) * amount),
		b: clampByte(from.b + (to.b - from.b) * amount),
	};
}

function lightenRgb(rgb: Rgb, amount: number): Rgb {
	return mixRgb(rgb, { r: 255, g: 255, b: 255 }, amount);
}

function darkenRgb(rgb: Rgb, amount: number): Rgb {
	return mixRgb(rgb, { r: 0, g: 0, b: 0 }, amount);
}

function getRelativeLuminance(rgb: Rgb): number {
	return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

function xterm256ToRgb(index: number): Rgb {
	if (index < 16) {
		const ansi16: Rgb[] = [
			{ r: 0, g: 0, b: 0 },
			{ r: 128, g: 0, b: 0 },
			{ r: 0, g: 128, b: 0 },
			{ r: 128, g: 128, b: 0 },
			{ r: 0, g: 0, b: 128 },
			{ r: 128, g: 0, b: 128 },
			{ r: 0, g: 128, b: 128 },
			{ r: 192, g: 192, b: 192 },
			{ r: 128, g: 128, b: 128 },
			{ r: 255, g: 0, b: 0 },
			{ r: 0, g: 255, b: 0 },
			{ r: 255, g: 255, b: 0 },
			{ r: 0, g: 0, b: 255 },
			{ r: 255, g: 0, b: 255 },
			{ r: 0, g: 255, b: 255 },
			{ r: 255, g: 255, b: 255 },
		];
		return ansi16[index] ?? ansi16[0]!;
	}

	if (index >= 232) {
		const gray = 8 + (index - 232) * 10;
		return { r: gray, g: gray, b: gray };
	}

	const cubeIndex = index - 16;
	const r = XTERM_CUBE_VALUES[Math.floor(cubeIndex / 36)] ?? 0;
	const g = XTERM_CUBE_VALUES[Math.floor((cubeIndex % 36) / 6)] ?? 0;
	const b = XTERM_CUBE_VALUES[cubeIndex % 6] ?? 0;
	return { r, g, b };
}

function parseAnsiRgb(ansi: string | undefined, channel: "fg" | "bg"): Rgb | undefined {
	if (!ansi) return undefined;
	const trueColorRe = channel === "fg" ? RE_FG_TRUECOLOR : RE_BG_TRUECOLOR;
	const indexedRe = channel === "fg" ? RE_FG_INDEXED : RE_BG_INDEXED;

	const trueColorMatch = ansi.match(trueColorRe);
	if (trueColorMatch) {
		return {
			r: clampByte(Number.parseInt(trueColorMatch[1] ?? "0", 10)),
			g: clampByte(Number.parseInt(trueColorMatch[2] ?? "0", 10)),
			b: clampByte(Number.parseInt(trueColorMatch[3] ?? "0", 10)),
		};
	}

	const palette256Match = ansi.match(indexedRe);
	if (palette256Match) {
		return xterm256ToRgb(Number.parseInt(palette256Match[1] ?? "0", 10));
	}

	return undefined;
}

function getThemeFgRgb(theme: Theme, token: ThemeFgToken): Rgb | undefined {
	return parseAnsiRgb(theme.getFgAnsi(token), "fg");
}

function getThemeBgRgb(theme: Theme, token: ThemeBgToken): Rgb | undefined {
	return parseAnsiRgb(theme.getBgAnsi(token), "bg");
}

// ── Palette cache (keyed by theme identity) ──

let cachedPaletteTheme: Theme | null = null;
let cachedPalette: PacmanPalette | null = null;

function derivePacmanPalette(theme: Theme): PacmanPalette {
	if (cachedPaletteTheme === theme && cachedPalette) return cachedPalette;

	const fallbackBackground = getThemeBgRgb(theme, "userMessageBg") ?? getThemeBgRgb(theme, "selectedBg");
	const isLightBackground = fallbackBackground
		? getRelativeLuminance(fallbackBackground) >= 0.55
		: false;
	const fallback = isLightBackground ? FALLBACK_PALETTES.light : FALLBACK_PALETTES.dark;

	const background = fallbackBackground ?? hexToRgb(isLightBackground ? "#f8f8f8" : "#18181e");
	const accent = getThemeFgRgb(theme, "accent") ?? hexToRgb(fallback.pacman);
	const syntaxType = getThemeFgRgb(theme, "syntaxType") ?? accent;
	const success = getThemeFgRgb(theme, "success") ?? hexToRgb(fallback.success);
	const warning = getThemeFgRgb(theme, "warning") ?? hexToRgb(fallback.warning);
	const error = getThemeFgRgb(theme, "error") ?? hexToRgb(fallback.error);
	const muted = getThemeFgRgb(theme, "muted") ?? hexToRgb(fallback.bracket);
	const dim = getThemeFgRgb(theme, "dim") ?? hexToRgb(fallback.eaten);

	const bracketBase = mixRgb(muted, dim, 0.35);
	const bracket = isLightBackground ? darkenRgb(bracketBase, 0.12) : lightenRgb(bracketBase, 0.08);
	const eaten = mixRgb(bracket, background, isLightBackground ? 0.38 : 0.42);
	const pacmanBase = mixRgb(syntaxType, accent, 0.3);
	const pacman = isLightBackground ? darkenRgb(pacmanBase, 0.08) : lightenRgb(pacmanBase, 0.05);

	cachedPaletteTheme = theme;
	cachedPalette = {
		bracket: rgbToHex(bracket),
		eaten: rgbToHex(eaten),
		pacman: rgbToHex(pacman),
		success: rgbToHex(success),
		warning: rgbToHex(warning),
		error: rgbToHex(error),
	};
	return cachedPalette;
}

function getTrackColorForIndex(palette: PacmanPalette, index: number, trackLength: number): string {
	const position = (index + 1) / trackLength;
	if (position <= 0.6) return palette.success;
	if (position <= 0.8) return palette.warning;
	return palette.error;
}

function getPacmanRenderState(palette: PacmanPalette, percent: number | null): PacmanRenderState {
	const normalized = Math.max(0, percent ?? 0);
	const base = hexToRgb(palette.pacman);

	if (normalized >= 90) {
		const amount = normalized >= 100 ? 0.9 : 0.65 + ((normalized - 90) / 10) * 0.15;
		return {
			color: rgbToHex(mixRgb(base, hexToRgb(palette.error), amount)),
			satiety: "stuffed",
			bold: true,
		};
	}

	if (normalized >= 70) {
		const amount = 0.28 + ((normalized - 70) / 20) * 0.24;
		return {
			color: rgbToHex(mixRgb(base, hexToRgb(palette.warning), amount)),
			satiety: "full",
			bold: true,
		};
	}

	return {
		color: palette.pacman,
		satiety: "normal",
		bold: false,
	};
}

function colorizeHex(hex: string, text: string): string {
	const r = Number.parseInt(hex.slice(1, 3), 16);
	const g = Number.parseInt(hex.slice(3, 5), 16);
	const b = Number.parseInt(hex.slice(5, 7), 16);
	return `\x1b[38;2;${r};${g};${b}m${text}\x1b[39m`;
}

function buildPacmanTrack(
	percent: number | null,
	trackLength: number,
	palette: PacmanPalette,
): string {
	const rawPercent = percent ?? 0;
	const effectivePercent = Math.max(0, Math.min(100, rawPercent));
	const isOverflow = rawPercent > 100;
	const pacmanIndex = Math.floor((effectivePercent / 100) * trackLength);
	const pacmanState = getPacmanRenderState(palette, percent);
	const cells: string[] = [];

	for (let index = 0; index < trackLength; index += 1) {
		if (effectivePercent >= 100 || index < pacmanIndex) {
			cells.push(colorizeHex(palette.eaten, "·"));
			continue;
		}

		if (!isOverflow && index === pacmanIndex) {
			const pacman = colorizeHex(pacmanState.color, "\u{F0BAF}");
			cells.push(pacmanState.bold ? boldColored(pacman) : pacman);
			continue;
		}

		cells.push(colorizeHex(getTrackColorForIndex(palette, index, trackLength), "•"));
	}

	const leftBracket = colorizeHex(palette.bracket, "[");
	const rightBracket = colorizeHex(palette.bracket, "]");
	const overflowPacmanBase = colorizeHex(pacmanState.color, "\u{F0BAF}");
	const overflowPacman = isOverflow
		? pacmanState.bold
			? boldColored(overflowPacmanBase)
			: overflowPacmanBase
		: "";
	return `${leftBracket}${cells.join("")}${rightBracket}${overflowPacman}`;
}

function buildContextBar(
	theme: Theme,
	percent: number | null,
	usedTokens: number,
	contextWindow: number,
	icon: string,
	palette: PacmanPalette,
	trackLength: number,
): string {
	const roundedPercent = percent === null ? 0 : Math.max(0, Math.min(999, Math.round(percent)));
	const severityToken = getContextUsageColorToken(percent);
	const iconColored = theme.fg(severityToken, icon);
	const track = buildPacmanTrack(percent, trackLength, palette);
	const percentStr = theme.fg(severityToken, `${roundedPercent}%`);
	const usageStr = dimColored(
		theme.fg(severityToken, `(${formatCount(usedTokens)}/${formatCount(contextWindow)})`),
	);

	return `${iconColored} ${track} ${percentStr} ${usageStr}`;
}

// ══════════════════════════════════════════════════════════════════
// Icons
// ══════════════════════════════════════════════════════════════════

const ICONS = {
	cwd: "\u{F0770}",
	git: "\u{F418}",
	ahead: "↑",
	behind: "↓",
	diverged: "⇕",
	stashed: "$",
	context: "⚡",
} as const;

// ══════════════════════════════════════════════════════════════════
// Prompt editor (Claude Code-style ❯ marker)
// ══════════════════════════════════════════════════════════════════

type AutocompleteEditorInternals = {
	autocompleteList?: Pick<import("@earendil-works/pi-tui").Component, "render">;
	isShowingAutocomplete?: () => boolean;
};

class PromptEditor extends CustomEditor {
	private readonly uiTheme: Theme;
	private readonly reset = "\x1b[0m";

	constructor(
		tui: import("@earendil-works/pi-tui").TUI,
		theme: EditorTheme,
		keybindings: KeybindingsManager,
		uiTheme: Theme,
	) {
		super(tui, theme, keybindings, { paddingX: 0 });
		this.borderColor = (text: string) => uiTheme.fg("border", text);
		this.uiTheme = uiTheme;
	}

	private fillLine(content: string, width: number): string {
		const truncated = truncateToWidth(content, width, "");
		const pad = " ".repeat(Math.max(0, width - visibleWidth(truncated)));
		return `${truncated}${pad}`;
	}

	render(width: number): string[] {
		const innerWidth = Math.max(1, width - 2);
		const rendered = super.render(innerWidth);
		const editorInternals = this as unknown as AutocompleteEditorInternals;
		const isShowingAutocomplete =
			typeof editorInternals.isShowingAutocomplete === "function"
				? Boolean(editorInternals.isShowingAutocomplete())
				: false;

		if (rendered.length < 2) {
			return super.render(width);
		}

		const { autocompleteList } = editorInternals;
		const autocompleteCount =
			isShowingAutocomplete && typeof autocompleteList?.render === "function"
				? autocompleteList.render(innerWidth).length
				: 0;
		const editorFrame =
			autocompleteCount > 0 && autocompleteCount < rendered.length
				? rendered.slice(0, -autocompleteCount)
				: rendered;
		const autocompleteLines =
			autocompleteCount > 0 && autocompleteCount < rendered.length
				? rendered.slice(-autocompleteCount)
				: [];

		if (editorFrame.length < 2) {
			return rendered;
		}

		const editorLines = editorFrame.slice(1, -1);

		const promptMarker = `${this.uiTheme.fg("accent", "❯")}${this.reset} `;
		const indent = "  ";
		const contentWidth = Math.max(1, width - 2); // 2 visible chars for prefix (❯ + space or 2 spaces)
		const top = this.uiTheme.fg("borderAccent", "─".repeat(width));
		const bottom = this.uiTheme.fg("borderAccent", "─".repeat(width));

		return [
			top,
			...editorLines.map((line, i) =>
				`${i === 0 ? promptMarker : indent}${this.fillLine(line, contentWidth)}`,
			),
			bottom,
			...autocompleteLines,
		];
	}
}

// ══════════════════════════════════════════════════════════════════
// Extension entry
// ══════════════════════════════════════════════════════════════════

export default function (pi: ExtensionAPI) {
	const state: FooterState = {
		modelLabel: "no-model",
		providerLabel: "Unknown",
		tokenLabel: "↑0 ↓0",
		tpsLabel: "",
		thinkingLevel: undefined,
		runtime: undefined,
		...emptyGitStatus(),
	};

	let requestFooterRender: (() => void) | undefined;
	let projectRefreshInFlight = false;
	let projectRefreshPending = false;
	let streamStartTime: number | null = null;

	const refresh = () => requestFooterRender?.();

	const syncState = (ctx: ExtensionContext) => {
		const totals = getUsageTotals(ctx);
		state.modelLabel = ctx.model?.id ?? "no-model";
		state.providerLabel = formatProviderLabel(ctx.model?.provider);
		state.tokenLabel = buildTokenLabel(totals);
		state.thinkingLevel = pi.getThinkingLevel();
	};

	const refreshProjectState = async (ctx: ExtensionContext) => {
		const [gitStatus, runtime] = await Promise.all([
			readGitStatus(ctx.cwd),
			readRuntimeInfo(ctx.cwd),
		]);
		Object.assign(state, gitStatus);
		state.runtime = runtime;
	};

	const scheduleProjectRefresh = (ctx: ExtensionContext) => {
		if (projectRefreshInFlight) {
			projectRefreshPending = true;
			return;
		}

		projectRefreshInFlight = true;
		void refreshProjectState(ctx).finally(() => {
			projectRefreshInFlight = false;
			refresh();
			if (projectRefreshPending) {
				projectRefreshPending = false;
				scheduleProjectRefresh(ctx);
			}
		});
	};

	const installFooter = (ctx: ExtensionContext) => {
		syncState(ctx);

		ctx.ui.setFooter((tui, theme, footerData) => {
			requestFooterRender = () => tui.requestRender();
			const unsubscribeBranch = footerData.onBranchChange(() => {
				scheduleProjectRefresh(ctx);
				tui.requestRender();
			});

			return {
				dispose: () => {
					unsubscribeBranch();
					requestFooterRender = undefined;
				},
				invalidate() {},
				render(width: number): string[] {
					const innerWidth = Math.max(1, width - 2);
					const palette = derivePacmanPalette(theme);
					const separator = theme.fg("borderMuted", " ");

					// === Line 1: Session info (model/provider/thinking | context/tokens) ===
					const modelLabel = theme.fg("accent", state.modelLabel);
					const providerLabel = theme.fg("text", state.providerLabel);
					const thinkingLabel =
						state.thinkingLevel && state.thinkingLevel !== "off"
							? theme.fg("muted", state.thinkingLevel)
							: "";

					const left1Parts = [
						`${modelLabel} ${providerLabel}`,
						thinkingLabel,
					].filter(Boolean);
					const left1 = left1Parts.join(separator);

					// Right side: context / tokens
					const contextUsage = ctx.getContextUsage();
					const contextWindow = ctx.model?.contextWindow ?? contextUsage?.contextWindow ?? 0;
					const usedTokens = contextUsage?.tokens ?? 0;
					const percent = contextUsage?.percent;

					const contextLabel =
						contextWindow > 0 && percent !== null && percent !== undefined
							? buildContextBar(
									theme,
									percent,
									usedTokens,
									contextWindow,
									ICONS.context,
									palette,
									innerWidth >= 60 ? 8 : 4,
							  )
							: theme.fg("muted", "--");

					const tokenLabel = theme.fg("muted", state.tokenLabel);
					const right1Parts = [contextLabel, tokenLabel].filter(Boolean);
					const right1 = right1Parts.join(separator);

					// Combine left and right for line 1
					const left1Width = visibleWidth(left1);
					const right1Width = visibleWidth(right1);
					const line1 =
						left1Width >= innerWidth
							? truncateToWidth(left1, innerWidth)
							: left1Width + 1 + right1Width <= innerWidth
								? `${left1}${" ".repeat(innerWidth - left1Width - right1Width)}${right1}`
								: left1;

					// === Line 2: Project info (cwd/git/runtime) + TPS ===
					const cwdLabel = theme.fg("syntaxOperator", formatCwdLabel(ctx.cwd, ICONS.cwd));
					const branch = state.branch;
					const gitIcon = theme.fg("syntaxKeyword", ICONS.git);
					const aheadBehind =
						state.ahead > 0 && state.behind > 0
							? ICONS.diverged
							: state.ahead > 0
								? ICONS.ahead
								: state.behind > 0
									? ICONS.behind
									: "";
					const branchLabel = branch
						? `${theme.fg("text", "on")} ${gitIcon} ${theme.fg("syntaxKeyword", branch)}${aheadBehind ? ` ${aheadBehind}` : ""}`
						: "";
					const runtimeLabel = formatRuntimeSegment(theme, state.runtime);

					const line2LeftParts = [cwdLabel, branchLabel, runtimeLabel].filter(Boolean);
					const line2Left = line2LeftParts.join(" ");

					const line2Right = state.tpsLabel
						? theme.fg("muted", state.tpsLabel)
						: "";

					const line2LeftWidth = visibleWidth(line2Left);
					const line2RightWidth = visibleWidth(line2Right);
					let line2: string;
					if (line2LeftWidth + 1 + line2RightWidth <= innerWidth) {
						line2 = `${line2Left}${" ".repeat(innerWidth - line2LeftWidth - line2RightWidth)}${line2Right}`;
					} else {
						line2 = truncateToWidth(line2Left, innerWidth);
					}

					// Render lines with width handling
					const renderLine = (content: string, w: number): string => {
						const contentWidth = visibleWidth(content);
						if (contentWidth >= w) {
							return truncateToWidth(content, w);
						}
						return `${content}${" ".repeat(w - contentWidth)}`;
					};

					return [` ${renderLine(line1, innerWidth)} `, ` ${renderLine(line2, innerWidth)} `];
				},
			};
		});
	};

	const installEditor = (ctx: ExtensionContext) => {
		const editorFactory = (tui: import("@earendil-works/pi-tui").TUI, theme: EditorTheme, keybindings: KeybindingsManager) =>
			new PromptEditor(tui, theme, keybindings, ctx.ui.theme);

		ctx.ui.setEditorComponent(editorFactory);
	};

	// ═══ Lifecycle ═══

	pi.on("session_start", async (_event, ctx) => {
		installFooter(ctx);
		installEditor(ctx);
		scheduleProjectRefresh(ctx);
		refresh();
	});

	pi.on("agent_start", async (_event, ctx) => {
		state.tpsLabel = "";
		syncState(ctx);
		refresh();
	});

	pi.on("agent_end", async (_event, ctx) => {
		syncState(ctx);
		scheduleProjectRefresh(ctx);
		refresh();
	});

	pi.on("model_select", async (_event, ctx) => {
		syncState(ctx);
		refresh();
	});

	pi.on("thinking_level_select", async () => {
		state.thinkingLevel = pi.getThinkingLevel();
		refresh();
	});

	pi.on("message_update", async (event) => {
		if (event.message.role !== "assistant") return;
		const streamEvent = event.assistantMessageEvent;
		const isOutputDelta =
			streamEvent.type === "text_delta" ||
			streamEvent.type === "thinking_delta" ||
			streamEvent.type === "toolcall_delta";
		if (isOutputDelta && streamStartTime === null) {
			streamStartTime = Date.now();
		}
	});

	pi.on("message_end", async (event, ctx) => {
		if (event.message.role !== "assistant") return;
		const outputTokens = event.message.usage?.output ?? 0;
		if (outputTokens > 0 && streamStartTime !== null) {
			const elapsedSec = (Date.now() - streamStartTime) / 1000;
			if (elapsedSec > 0) {
				const tps = Math.round(outputTokens / elapsedSec);
				state.tpsLabel = `${tps}tok/s`;
			}
		}
		streamStartTime = null;
		syncState(ctx);
		scheduleProjectRefresh(ctx);
		refresh();
	});

	pi.on("tool_execution_end", async (_event, ctx) => {
		syncState(ctx);
		scheduleProjectRefresh(ctx);
		refresh();
	});

	pi.on("session_compact", async (_event, ctx) => {
		syncState(ctx);
		scheduleProjectRefresh(ctx);
		refresh();
	});
}
