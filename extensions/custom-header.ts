/**
 * custom-header - π splash screen with rainbow logo, model info, and loaded counts.
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

// ═══ ANSI helpers ═══

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function fg256(code: number, text: string): string {
	return `\x1b[38;5;${code}m${text}${RESET}`;
}

function fgRgb(r: number, g: number, b: number, text: string): string {
	return `\x1b[38;2;${r};${g};${b}m${text}${RESET}`;
}

const MUTED = (text: string) => fg256(245, text);
const ACCENT = (text: string) => fg256(75, text);
const GREEN = (text: string) => fgRgb(75, 202, 129, text);
const ORANGE = (text: string) => fgRgb(255, 183, 93, text);

// ═══ Rainbow palette (from sf-pi ohana-spinner) ═══

type Rgb = [number, number, number];

const RAINBOW_PALETTE: Rgb[] = [
	[200, 120, 130],
	[210, 150, 120],
	[200, 185, 120],
	[130, 190, 140],
	[120, 170, 200],
	[150, 130, 190],
	[185, 130, 180],
];

// ═══ π Logo ═══

const PI_LOGO = [
	" ▀████████████▀ ",
	"   ███    ███   ",
	"   ███    ███   ",
	"   ███    ███   ",
	"  ▄███▄  ▄███▄  ",
];

function paintRow(
	row: string,
	charIndex: { value: number },
): string {
	let result = "";
	for (const ch of row) {
		if (ch === " ") {
			result += ch;
			continue;
		}
		const [r, g, b] = RAINBOW_PALETTE[charIndex.value % RAINBOW_PALETTE.length];
		result += fgRgb(r, g, b, ch);
		charIndex.value++;
	}
	return result;
}

// ═══ Helpers ═══



function visibleLen(text: string): number {
	// Strip ANSI escape sequences
	const stripped = text.replace(/\x1b\[[0-9;]*m/g, "");
	let width = 0;
	for (const ch of stripped) {
		// CJK characters and fullwidth forms occupy 2 columns
		if (/[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/.test(ch)) {
			width += 2;
		} else {
			width += 1;
		}
	}
	return width;
}

function center(text: string, width: number): string {
	const vis = visibleLen(text);
	const pad = Math.max(0, Math.floor((width - vis) / 2));
	return " ".repeat(pad) + text;
}

// ═══ Extension ═══

export default function (pi: ExtensionAPI) {
	let requestRender: (() => void) | undefined;
	let cachedModelName = "unknown";
	let cachedWarnings: string[] = [];
	let cachedFooterLine = "";

	function updateSessionCache(cwd: string) {
		const warnings: string[] = [];
		if (!existsSync(join(cwd, ".git"))) {
			warnings.push(ORANGE("⚠") + " " + MUTED("非 git 仓库，建议使用 git 管理项目"));
		} else {
			try {
				const stdout = execFileSync("git", ["status", "--porcelain"], {
					cwd,
					encoding: "utf8",
					timeout: 5000,
				});
				const count = stdout.trim().split("\n").filter(Boolean).length;
				if (count > 0) {
					warnings.push(ORANGE("⚠") + " " + MUTED(`${count} 个未提交的改动`));
				}
			} catch {
				// ignore
			}
		}
		cachedWarnings = warnings;

		const homeDir = process.env.HOME || process.env.USERPROFILE || "";
		const extDir = join(homeDir, ".pi", "agent", "extensions");
		const skillDir = join(homeDir, ".agents", "skills");
		let extCount = 0;
		try {
			const entries = readdirSync(extDir, { withFileTypes: true });
			extCount = entries.filter(
				(e) =>
					!e.name.startsWith(".") &&
					e.name !== "node_modules" &&
					(e.name.endsWith(".ts") || e.isDirectory()),
			).length;
		} catch {
			// ignore
		}
		let skillCount = 0;
		try {
			if (existsSync(skillDir)) {
				skillCount = readdirSync(skillDir, { withFileTypes: true }).filter(
					(d) => d.isDirectory(),
				).length;
			}
		} catch {
			// ignore
		}
		const parts: string[] = [];
		if (extCount > 0) parts.push(`${GREEN(`${extCount}`)} extensions`);
		if (skillCount > 0) parts.push(`${GREEN(`${skillCount}`)} skills`);
		cachedFooterLine = parts.join(` ${MUTED("·")} `);
	}

	function installHeader(ctx: ExtensionContext) {
		ctx.ui.setHeader((tui) => {
			requestRender = () => tui.requestRender();
			return {
				render(width: number): string[] {
					const lines: string[] = [];

					lines.push("");
					lines.push(center(`${BOLD}欢迎回来${RESET}`, width));
					lines.push("");

					const charIndex = { value: 0 };
					for (const row of PI_LOGO) {
						lines.push(center(paintRow(row, charIndex), width));
					}
					lines.push("");

					lines.push(center(ACCENT(cachedModelName), width));
					lines.push("");

					for (const warning of cachedWarnings) {
						lines.push(center(warning, width));
					}
					if (cachedWarnings.length > 0) lines.push("");

					if (cachedFooterLine) {
						lines.push(center(cachedFooterLine, width));
					}

					lines.push("");
					return lines;
				},
				invalidate() {
					tui.requestRender();
				},
			};
		});
	}

	pi.on("session_start", async (_event, ctx) => {
		if (!ctx.hasUI) return;
		cachedModelName = ctx.model?.name || ctx.model?.id || "unknown";
		updateSessionCache(ctx.cwd);
		installHeader(ctx);
	});



	pi.on("model_select", async (event) => {
		cachedModelName = event.model.name || event.model.id || "unknown";
		requestRender?.();
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		requestRender = undefined;
		if (ctx.hasUI) ctx.ui.setHeader(undefined);
	});

	pi.registerCommand("custom-header", {
		description: "Enable the custom π splash header",
		handler: async (_args, ctx) => {
			installHeader(ctx);
			ctx.ui.notify("Custom header enabled", "info");
		},
	});

	pi.registerCommand("custom-header-builtin", {
		description: "Restore pi's built-in header for this session",
		handler: async (_args, ctx) => {
			ctx.ui.setHeader(undefined);
			ctx.ui.notify("Built-in header restored", "info");
		},
	});
}
