/**
 * pi-shimmer - Rainbow shimmer spinner with Chinese verbs, stall detection,
 * thinking state, and token estimation.
 *
 * Derived from pi-shimmer by Jabbslad (MIT) and pi-animations by arpagon (MIT).
 * Rainbow shimmer: sine-wave gradient sweep (magenta → purple → cyan).
 * Stall detection: fades to red when tokens stop flowing for >3s.
 */

import type {
	ExtensionAPI,
	ExtensionContext,
	AgentStartEvent,
	AgentEndEvent,
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
	return VERBS[Math.floor(Math.random() * VERBS.length)];
}

// ═══ Dots spinner (baseline-aligned) ═══

const DOTS = ["⠁", "⠂", "⠄", "⡀", "⢀", "⠠", "⠐", "⠈"];

// ═══ ANSI helpers ═══

const rgb = (r: number, g: number, b: number) => `\x1b[38;2;${r};${g};${b}m`;
const bold = "\x1b[1m";
const nobold = "\x1b[22m";
const reset = "\x1b[0m";

// 蓝色 dots spinner frames (定义在 rgb 之后)
const BLUE_DOTS = DOTS.map(d => rgb(95, 175, 255) + d + reset);

function lerp(a: number, b: number, t: number): number {
	return Math.round(a + (b - a) * t);
}

// ═══ Gradient (magenta → purple → cyan) ═══

const PI_GRAD = [
	[255, 0, 135],
	[175, 95, 175],
	[135, 95, 215],
	[95, 95, 255],
	[95, 175, 255],
	[0, 255, 255],
];

const BASE = [200, 200, 200];
const STALL_RED = [171, 43, 63];
const STALL_BASE = [140, 60, 60];

// ═══ Stall tracking ═══

const STALL_START_MS = 3000;
const STALL_FADE_MS = 2000;
let stalledIntensity = 0;

function computeStallIntensity(timeSinceToken: number): number {
	const target = timeSinceToken > STALL_START_MS
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

// ═══ Shimmer renderer ═══

function renderShimmer(text: string, frame: number, stall: number): string {
	const baseR = lerp(BASE[0], STALL_BASE[0], stall);
	const baseG = lerp(BASE[1], STALL_BASE[1], stall);
	const baseB = lerp(BASE[2], STALL_BASE[2], stall);

	let line = "";
	for (let i = 0; i < text.length; i++) {
		const wave = Math.sin((i - frame * 0.3) * 0.8);
		if (wave > 0.3) {
			const intensity = (wave - 0.3) / 0.7;
			const gi = Math.floor((i + frame * 0.5) % (PI_GRAD.length * 2));
			const gIdx = gi < PI_GRAD.length ? gi : PI_GRAD.length * 2 - 1 - gi;
			const gc = PI_GRAD[Math.min(gIdx, PI_GRAD.length - 1)];

			const gcR = lerp(gc[0], STALL_RED[0], stall);
			const gcG = lerp(gc[1], STALL_RED[1], stall);
			const gcB = lerp(gc[2], STALL_RED[2], stall);

			const r = lerp(baseR, gcR, intensity);
			const g = lerp(baseG, gcG, intensity);
			const b = lerp(baseB, gcB, intensity);
			line += bold + rgb(r, g, b) + text[i] + nobold;
		} else {
			line += rgb(baseR, baseG, baseB) + text[i];
		}
	}
	return line + reset;
}

// ═══ Format helpers ═══

function formatDuration(ms: number): string {
	const s = Math.floor(ms / 1000);
	if (s < 60) return `${s}s`;
	const m = Math.floor(s / 60);
	return `${m}m ${(s % 60).toString().padStart(2, "0")}s`;
}

// ═══ Extension ═══

const SHOW_TIMER_AFTER_MS = 30000;

type MessageUpdateLike = {
	assistantMessageEvent: {
		type: string;
	};
};

function isThinkingStart(event: MessageUpdateLike): boolean {
	return event.assistantMessageEvent.type === "thinking_start";
}

function isThinkingEnd(event: MessageUpdateLike): boolean {
	return event.assistantMessageEvent.type === "thinking_end";
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

	function touchToken() {
		if (timer) lastTokenTime = Date.now();
	}

	function isWaitingForQuestion(): boolean {
		return pendingQuestionCount > 0;
	}

	function beginQuestionWait() {
		pendingQuestionCount++;
		if (pendingQuestionCount === 1) {
			questionWaitStartTime = Date.now();
			lastTokenTime = Date.now();
			resetStallState();
		}
	}

	function endQuestionWait() {
		if (pendingQuestionCount <= 0) return;
		pendingQuestionCount--;
		if (pendingQuestionCount === 0) {
			if (questionWaitStartTime > 0) {
				pausedDurationMs += Date.now() - questionWaitStartTime;
			}
			questionWaitStartTime = 0;
			lastTokenTime = Date.now();
			resetStallState();
		}
	}

	function resetQuestionWaitState() {
		pendingQuestionCount = 0;
		questionWaitStartTime = 0;
		pausedDurationMs = 0;
	}

	function render(): string {
		if (isWaitingForQuestion()) {
			resetStallState();
			return renderShimmer("等待回答中…", frame, 0) + reset;
		}

		const timeSinceToken = Date.now() - lastTokenTime;
		const stall = computeStallIntensity(timeSinceToken);

		const text = `${verb}中…`;
		const shimmer = renderShimmer(text, frame, stall);

		const elapsed = Math.max(0, Date.now() - startTime - pausedDurationMs);
		let suffix = "";
		if (elapsed > SHOW_TIMER_AFTER_MS) {
			const parts: string[] = [formatDuration(elapsed)];

			if (thinkingStartTime > 0) {
				parts.push("thinking");
			} else if (thoughtDurationMs > 0) {
				parts.push(`thought ${Math.round(thoughtDurationMs / 1000)}s`);
			}

			suffix = " " + rgb(140, 140, 140) + "(" + parts.join(" · ") + ")";
		}

		return shimmer + suffix + reset;
	}

	function startAnimation(ctx: ExtensionContext) {
		stopAnimation();
		frame = 0;
		verb = randomVerb();
		startTime = Date.now();
		lastTokenTime = Date.now();
		thinkingStartTime = 0;
		thoughtDurationMs = 0;
		resetQuestionWaitState();
		resetStallState();

		ctx.ui.setWorkingIndicator({ frames: [...BLUE_DOTS] });

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
	}

	pi.on("agent_start", async (_event: AgentStartEvent, ctx: ExtensionContext) => {
		if (!ctx.hasUI) return;
		startAnimation(ctx);
	});

	pi.on("message_update", async (event) => {
		if (!timer || event.message.role !== "assistant") return;
		lastTokenTime = Date.now();

		if (isThinkingStart(event)) {
			thinkingStartTime = Date.now();
			thoughtDurationMs = 0;
		} else if (isThinkingEnd(event) && thinkingStartTime > 0) {
			thoughtDurationMs = Date.now() - thinkingStartTime;
			thinkingStartTime = 0;
		}
	});

	pi.on("tool_execution_start", async (event) => {
		if (event.toolName === "question") {
			beginQuestionWait();
			return;
		}
		touchToken();
	});

	pi.on("tool_execution_end", async (event) => {
		if (event.toolName === "question") {
			endQuestionWait();
			return;
		}
		touchToken();
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
