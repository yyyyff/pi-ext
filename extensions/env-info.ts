import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import * as os from "node:os";

/**
 * Pi Environment Info Extension
 *
 * Auto-detects environment info and injects into system prompt.
 * Runs detection once at session_start, injects every turn via before_agent_start.
 */

export function getEnvInfo(): string[] {
	const lines: string[] = [];

	// OS + Arch
	const platform = os.platform();
	const arch = os.arch();
	const release = os.release();

	let osLabel: string;
	if (platform === "darwin") {
		const macVer = process.env.MACOS_VERSION || "";
		osLabel = macVer ? `macOS ${macVer}` : "macOS";
	} else if (platform === "linux") {
		osLabel = "Linux";
	} else if (platform === "win32") {
		osLabel = "Windows";
	} else {
		osLabel = platform;
	}

	lines.push(`- OS: ${osLabel} (${arch}), kernel ${release}`);

	// Shell
	const shell = process.env.SHELL?.split("/").pop() ?? "unknown";
	lines.push(`- Shell: ${shell}`);

	// Terminal
	const terminal =
		process.env.TERM_PROGRAM ??
		process.env.TERMINAL_EMULATOR ??
		process.env.TERM ??
		"unknown";
	lines.push(`- Terminal: ${terminal}`);

	// Encoding
	lines.push(`- Encoding: UTF-8`);

	return lines;
}

const ENV_BLOCK_PREFIX = "\n\n## Environment\n";

export default function envInfo(pi: ExtensionAPI) {
	let envBlock = "";

	pi.on("session_start", async () => {
		const info = getEnvInfo();
		envBlock = ENV_BLOCK_PREFIX + info.join("\n");
	});

	pi.on("before_agent_start", async (event) => {
		if (!envBlock) return;
		return {
			systemPrompt: event.systemPrompt + envBlock,
		};
	});
}
