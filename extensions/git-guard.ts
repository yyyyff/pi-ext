import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * Pi Git Guard Extension
 *
 * 1. 拦截可能打开编辑器的 git commit
 * 2. 拦截交互式 git rebase --continue
 * 3. 强制 commit message 包含中文（仅检查 -m / --message）
 */

export function hasChinese(text: string): boolean {
	return /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text);
}

export function splitShellSegments(command: string): string[] {
	const segments: string[] = [];
	let current = "";
	let inSingleQuote = false;
	let inDoubleQuote = false;
	let escaped = false;

	for (let i = 0; i < command.length; i++) {
		const ch = command[i];
		const next = command[i + 1];

		if (escaped) {
			current += ch;
			escaped = false;
			continue;
		}

		if (ch === "\\") {
			current += ch;
			escaped = true;
			continue;
		}

		if (ch === "'" && !inDoubleQuote) {
			inSingleQuote = !inSingleQuote;
			current += ch;
			continue;
		}

		if (ch === '"' && !inSingleQuote) {
			inDoubleQuote = !inDoubleQuote;
			current += ch;
			continue;
		}

		if (!inSingleQuote && !inDoubleQuote) {
			if ((ch === "&" && next === "&") || (ch === "|" && next === "|")) {
				const trimmed = current.trim();
				if (trimmed) segments.push(trimmed);
				current = "";
				i++;
				continue;
			}

			if (ch === ";" || ch === "|" || ch === "\n") {
				const trimmed = current.trim();
				if (trimmed) segments.push(trimmed);
				current = "";
				continue;
			}
		}

		current += ch;
	}

	const trimmed = current.trim();
	if (trimmed) segments.push(trimmed);
	return segments;
}

export function stripLeadingEnvAssignments(segment: string): string {
	let stripped = segment.trim().replace(/^\(+\s*/, "");
	while (true) {
		const next = stripped.replace(
			/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/,
			"",
		);
		if (next === stripped) return stripped;
		stripped = next.trimStart();
	}
}

export function extractCommitMessage(command: string): string | null {
	const match = command.match(
		/(?:-m|--message)(?:=|\s+)(?:"([^"]*)"|'([^']*)'|([^\s][\s\S]*?))(?=\s+(?:--?[A-Za-z]|$)|$)/,
	);
	if (!match) return null;
	return match[1] ?? match[2] ?? match[3] ?? null;
}

function hasNonInteractiveEditorOverride(command: string): boolean {
	return /(\bGIT_EDITOR=\S+|\bGIT_SEQUENCE_EDITOR=\S+|-c\s+core\.editor=\S+|-c\s+sequence\.editor=\S+)/.test(
		command,
	);
}

function isNonInteractiveCommit(gitCmd: string, segment: string): boolean {
	if (!/^git\s+commit(\s|$)/.test(gitCmd)) return false;
	if (hasNonInteractiveEditorOverride(segment)) return true;
	if (
		/(^|\s)(-m|--message|-F|--file|-C|--reuse-message|--fixup|--fixup=|--squash|--squash=)(=|\s+)/.test(
			gitCmd,
		)
	) {
		return true;
	}
	if (/(^|\s)--amend(\s|$)/.test(gitCmd) && /(^|\s)--no-edit(\s|$)/.test(gitCmd)) {
		return true;
	}
	return false;
}

function checkGitCommand(
	command: string,
): { block: true; reason: string } | undefined {
	for (const segment of splitShellSegments(command)) {
		const gitCmd = stripLeadingEnvAssignments(segment);
		if (!/^git\b/.test(gitCmd)) continue;

		if (/^git\s+commit(\s|$)/.test(gitCmd)) {
			if (!isNonInteractiveCommit(gitCmd, segment)) {
				return {
					block: true,
					reason:
						'git commit 可能打开编辑器，请使用 -m / --message / -F / -C / --reuse-message，或在 amend 时加 --no-edit',
				};
			}

			const message = extractCommitMessage(gitCmd);
			if (message && !hasChinese(message)) {
				return {
					block: true,
					reason:
						"提交信息请遵守 Conventional Commits 规范，并用中文描述主要内容",
				};
			}
		}

		if (
			/^git\s+rebase(\s|$)/.test(gitCmd) &&
			/(^|\s)--continue(\s|$)/.test(gitCmd) &&
			!hasNonInteractiveEditorOverride(segment)
		) {
			return {
				block: true,
				reason:
					"git rebase --continue 可能打开编辑器，请使用 GIT_EDITOR=true git rebase --continue",
			};
		}
	}
	return undefined;
}

export default function gitGuard(pi: ExtensionAPI) {
	pi.on("tool_call", async (event) => {
		if (event.toolName !== "bash") return;
		const command = (event.input as { command?: string }).command ?? "";
		return checkGitCommand(command);
	});
}
