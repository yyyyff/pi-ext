/**
 * pi-shimmer - Rainbow shimmer spinner with Chinese verbs, stall detection,
 * and thinking state.
 *
 * Derived from pi-shimmer by Jabbslad (MIT) and pi-animations by arpagon (MIT).
 * Rainbow shimmer: sine-wave gradient sweep (magenta → purple → cyan).
 * Stall detection: fades to red when tokens stop flowing for >3s.
 */

import type {
	AgentEndEvent,
	AgentStartEvent,
	ExtensionAPI,
	ExtensionContext,
} from "@earendil-works/pi-coding-agent";

// ═══ Chinese verbs ═══

const VERBS = [
	"思考",
	"酝酿",
	"盘算",
	"琢磨",
	"推敲",
	"酝酿灵感",
	"头脑风暴",
	"深度思考",
	"组织思路",
	"梳理逻辑",
	"运筹帷幄",
	"精雕细琢",
	"反复推敲",
	"灵光闪现",
	"举一反三",
	"融会贯通",
	"抽丝剥茧",
	"高瞻远瞩",
	"集思广益",
	"深思熟虑",
	"冥思苦想",
	"触类旁通",
	"潜心钻研",
	"拨云见日",
	"未雨绸缪",
	"见微知著",
	"追根溯源",
	"旁征博引",
	"明察秋毫",
	"胸有成竹",
	"厚积薄发",
	"运筹千里",
	"草船借箭",
	"出谋划策",
	"审时度势",
];

function randomVerb(): string {
	return VERBS[Math.floor(Math.random() * VERBS.length)] ?? "思考";
}

// ═══ Dots spinner (baseline-aligned) ═══

const DOTS = ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"];

// ═══ ANSI helpers ═══

const rgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
const bold = "\x1b[1m";
const nobold = "\x1b[22m";
const reset = "\x1b[0m";

const dim = (text: string) => `${rgb(140, 140, 140)}${text}${reset}`;

// 蓝色 dots spinner frames (定义在 rgb 之后)
const BLUE_DOTS = DOTS.map((d) => rgb(95, 175, 255) + d + reset);

function lerp(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

// ═══ Gradient (magenta → purple → cyan) ═══

type RGB = readonly [number, number, number];

const PI_GRAD: readonly RGB[] = [
	[255, 0, 135],
	[175, 95, 175],
	[135, 95, 215],
	[95, 95, 255],
	[95, 175, 255],
	[0, 255, 255],
];

const BASE: RGB = [200, 200, 200];
const STALL_RED: RGB = [171, 43, 63];
const STALL_BASE: RGB = [140, 60, 60];

// ═══ Stall tracking ═══

const STALL_START_MS = 3000;
const STALL_FADE_MS = 2000;

// ═══ Shimmer renderer ═══

function renderShimmer(text: string, frame: number, stall: number): string {
	const baseR = lerp(BASE[0], STALL_BASE[0], stall);
	const baseG = lerp(BASE[1], STALL_BASE[1], stall);
	const baseB = lerp(BASE[2], STALL_BASE[2], stall);
	const chars = Array.from(text);

	let line = "";
	for (let i = 0; i < chars.length; i++) {
		const ch = chars[i] ?? "";
		const wave = Math.sin((i - frame * 0.3) * 0.8);
		if (wave > 0.3) {
			const intensity = (wave - 0.3) / 0.7;
			const gi = Math.floor((i + frame * 0.5) % (PI_GRAD.length * 2));
			const gIdx = gi < PI_GRAD.length ? gi : PI_GRAD.length * 2 - 1 - gi;
			const gc = PI_GRAD[Math.min(gIdx, PI_GRAD.length - 1)] ?? PI_GRAD[0]!;

			const gcR = lerp(gc[0], STALL_RED[0], stall);
			const gcG = lerp(gc[1], STALL_RED[1], stall);
			const gcB = lerp(gc[2], STALL_RED[2], stall);

			const r = lerp(baseR, gcR, intensity);
			const g = lerp(baseG, gcG, intensity);
			const b = lerp(baseB, gcB, intensity);
			line += bold + rgb(r, g, b) + ch + nobold;
		} else {
			line += rgb(baseR, baseG, baseB) + ch;
		}
	}
	return line + reset;
}

// ═══ Format helpers ═══

function formatDuration(ms: number): string {
	const totalSeconds = Math.floor(ms / 1000);
	if (totalSeconds < 60) return `${totalSeconds}s`;

	const seconds = totalSeconds % 60;
	const totalMinutes = Math.floor(totalSeconds / 60);
	if (totalMinutes < 60) {
		return `${totalMinutes}m ${seconds.toString().padStart(2, "0")}s`;
	}

	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${minutes}m ${seconds.toString().padStart(2, "0")}s`;
}

// ═══ Extension ═══

const SHOW_TIMER_AFTER_MS = 30000;

function isThinkingStart(type: string | undefined): boolean {
	return type === "thinking_start";
}

function isThinkingEnd(type: string | undefined): boolean {
	return type === "thinking_end";
}

export default function shimmerSpinner(pi: ExtensionAPI) {
	let timer: ReturnType<typeof setInterval> | null = null;
	let frame = 0;
	let verb = "";
	let startTime = 0;
	let lastTokenTime = 0;
	let thinkingStartTime = 0;
	let thoughtDurationMs = 0;
	let pendingQuestionCount = 0;
	let questionWaitStartTime = 0;
	let pausedDurationMs = 0;
	let activeTools = new Map<string, string>();
	let stalledIntensity = 0;

	function computeStallIntensity(timeSinceToken: number): number {
		const target =
			timeSinceToken > STALL_START_MS
				? Math.min((timeSinceToken - STALL_START_MS) / STALL_FADE_MS, 1)
				: 0;
		const diff = target - stalledIntensity;
		if (Math.abs(diff) < 0.01) {
			stalledIntensity = target;
		} else {
			stalledIntensity += diff * 0.1;
		}
		return stalledIntensity;
	}

	function resetStallState(): void {
		stalledIntensity = 0;
	}

	function touchToken(now = Date.now()) {
		if (timer) lastTokenTime = now;
	}

	function isWaitingForQuestion(): boolean {
		return pendingQuestionCount > 0;
	}

	function isExecutingTool(): boolean {
		return activeTools.size > 0;
	}

	function activeToolLabel(): string | undefined {
		if (activeTools.size === 0) return undefined;
		if (activeTools.size > 1) return `多个工具 ×${activeTools.size}`;
		return activeTools.values().next().value;
	}

	function beginQuestionWait(now = Date.now()) {
		pendingQuestionCount++;
		if (pendingQuestionCount === 1) {
			questionWaitStartTime = now;
			lastTokenTime = now;
			resetStallState();
		}
	}

	function endQuestionWait(now = Date.now()) {
		if (pendingQuestionCount <= 0) return;
		pendingQuestionCount--;
		if (pendingQuestionCount === 0) {
			if (questionWaitStartTime > 0) {
				pausedDurationMs += now - questionWaitStartTime;
			}
			questionWaitStartTime = 0;
			lastTokenTime = now;
			resetStallState();
		}
	}

	function resetQuestionWaitState() {
		pendingQuestionCount = 0;
		questionWaitStartTime = 0;
		pausedDurationMs = 0;
	}

	function beginToolExecution(toolCallId: string, toolName: string, now = Date.now()) {
		activeTools.set(toolCallId, toolName);
		lastTokenTime = now;
		resetStallState();
	}

	function endToolExecution(toolCallId: string, now = Date.now()) {
		activeTools.delete(toolCallId);
		lastTokenTime = now;
		resetStallState();
	}

	function resetToolExecutionState() {
		activeTools.clear();
	}

	function render(now = Date.now()): string {
		if (isWaitingForQuestion()) {
			resetStallState();
			return renderShimmer("等待回答中…", frame, 0) + reset;
		}

		if (isExecutingTool()) {
			resetStallState();
			const toolLabel = activeToolLabel();
			const suffix = toolLabel ? ` ${dim(`(${toolLabel})`)}` : "";
			return renderShimmer("执行工具中…", frame, 0) + suffix + reset;
		}

		const timeSinceToken = now - lastTokenTime;
		const stall = computeStallIntensity(timeSinceToken);

		const text = `${verb}中…`;
		const shimmer = renderShimmer(text, frame, stall);

		const elapsed = Math.max(0, now - startTime - pausedDurationMs);
		let suffix = "";
		if (elapsed > SHOW_TIMER_AFTER_MS) {
			const parts: string[] = [formatDuration(elapsed)];

			if (thinkingStartTime > 0) {
				parts.push("thinking");
			} else if (thoughtDurationMs > 0) {
				parts.push(`thought ${Math.round(thoughtDurationMs / 1000)}s`);
			}

			suffix = ` ${dim(`(${parts.join(" · ")})`)}`;
		}

		return shimmer + suffix + reset;
	}

	function startAnimation(ctx: ExtensionContext) {
		stopAnimation();
		const now = Date.now();
		frame = 0;
		verb = randomVerb();
		startTime = now;
		lastTokenTime = now;
		thinkingStartTime = 0;
		thoughtDurationMs = 0;
		resetQuestionWaitState();
		resetToolExecutionState();
		resetStallState();

		ctx.ui.setWorkingIndicator({ frames: BLUE_DOTS });
		ctx.ui.setWorkingMessage(render(now));

		timer = setInterval(() => {
			frame++;
			ctx.ui.setWorkingMessage(render());
		}, 80);
	}

	function stopAnimation() {
		if (timer) {
			clearInterval(timer);
			timer = null;
		}
		resetQuestionWaitState();
		resetToolExecutionState();
		resetStallState();
	}

	pi.on("agent_start", async (_event: AgentStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		startAnimation(ctx);
	});

	pi.on("message_update", async (event) => {
		if (!timer || event.message.role !== "assistant") return;
		const now = Date.now();
		lastTokenTime = now;

		const updateType = event.assistantMessageEvent?.type;
		if (isThinkingStart(updateType)) {
			thinkingStartTime = now;
			thoughtDurationMs = 0;
		} else if (isThinkingEnd(updateType) && thinkingStartTime > 0) {
			thoughtDurationMs = now - thinkingStartTime;
			thinkingStartTime = 0;
		}
	});

	pi.on("tool_execution_start", async (event) => {
		const now = Date.now();
		if (event.toolName === "question") {
			beginQuestionWait(now);
			return;
		}
		beginToolExecution(event.toolCallId, event.toolName, now);
	});

	pi.on("tool_execution_update", async (event) => {
		if (event.toolName === "question") return;
		touchToken();
	});

	pi.on("tool_execution_end", async (event) => {
		const now = Date.now();
		if (event.toolName === "question") {
			endQuestionWait(now);
			return;
		}
		endToolExecution(event.toolCallId, now);
	});

	pi.on("agent_end", async (_event: AgentEndEvent, ctx: ExtensionContext) => {
		stopAnimation();
		if (ctx?.hasUI) {
			ctx.ui.setWorkingIndicator();
			ctx.ui.setWorkingMessage();
		}
	});

	pi.on("session_shutdown", async (_event, ctx) => {
		stopAnimation();
		if (ctx?.hasUI) {
			ctx.ui.setWorkingIndicator();
			ctx.ui.setWorkingMessage();
		}
	});
}
