/**
 * autogit - Quick git add/commit/push with manual or auto-generated commit messages.
 *
 * Usage:
 *   /autogit "fix: optimize custom-header"   → commit with exact message
 *   /autogit 优化custom-header               → commit with plain text
 *   /autogit                                  → auto-generate from git diff --stat
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { execFileSync } from "node:child_process";

function runGit(args: string[], cwd: string): string {
	try {
		return execFileSync("git", args, { cwd, encoding: "utf8", timeout: 10000 }).trim();
	} catch {
		return "";
	}
}

function stripQuotes(text: string): string {
	if (
		(text.startsWith('"') && text.endsWith('"')) ||
		(text.startsWith("'") && text.endsWith("'"))
	) {
		return text.slice(1, -1);
	}
	return text;
}

function generateMessageFromStat(cwd: string): string {
	const stat = runGit(["diff", "--stat"], cwd);
	const short = runGit(["diff", "--shortstat"], cwd);

	if (!short) {
		// Check staged changes
		const stagedStat = runGit(["diff", "--cached", "--shortstat"], cwd);
		if (stagedStat) return `update: ${stagedStat.trim()}`;
		return "update: no changes";
	}

	// Parse file counts from shortstat output like "3 files changed, 10 insertions(+), 2 deletions(-)"
	const fileMatch = short.match(/(\d+) files? changed/);
	const insertMatch = short.match(/(\d+) insertion/);
	const deleteMatch = short.match(/(\d+) deletion/);

	const fileCount = fileMatch ? Number(fileMatch[1]) : 0;
	const insertions = insertMatch ? Number(insertMatch[1]) : 0;
	const deletions = deleteMatch ? Number(deleteMatch[1]) : 0;

	// Also check untracked files
	const untrackedRaw = runGit(["ls-files", "--others", "--exclude-standard"], cwd);
	const untrackedCount = untrackedRaw ? untrackedRaw.split("\n").filter(Boolean).length : 0;

	const parts: string[] = [];
	if (fileCount > 0) parts.push(`${fileCount} modified`);
	if (untrackedCount > 0) parts.push(`${untrackedCount} added`);

	const summary = parts.length > 0 ? parts.join(", ") : "changes";

	const detail: string[] = [];
	if (insertions > 0) detail.push(`+${insertions}`);
	if (deletions > 0) detail.push(`-${deletions}`);
	const detailStr = detail.length > 0 ? ` (${detail.join(", ")})` : "";

	return `update: ${summary}${detailStr}`;
}

function getCurrentBranch(cwd: string): string {
	return runGit(["branch", "--show-current"], cwd);
}

function hasRemote(cwd: string): boolean {
	const result = runGit(["remote"], cwd);
	return result.length > 0;
}

function getRemoteUrl(cwd: string): string {
	return runGit(["remote", "get-url", "origin"], cwd);
}

function sshToHttps(url: string): string {
	// git@github.com:owner/repo.git → https://github.com/owner/repo
	return url.replace(/^git@([^:]+):([^/].+?)(?:\.git)?$/, "https://$1/$2");
}

function buildPullRequestUrl(remoteUrl: string, branch: string): string {
	const https = sshToHttps(remoteUrl).replace(/\.git$/, "");
	return `${https}/compare/main...${branch}`;
}

export default function (pi: ExtensionAPI) {
	pi.registerCommand("autogit", {
		description: "Quick git add/commit/push. Provide a message or leave empty to auto-generate.",
		handler: async (args, ctx) => {
			const cwd = ctx.cwd;

			// Check if inside git repo
			const isGitRepo = runGit(["rev-parse", "--is-inside-work-tree"], cwd);
			if (isGitRepo !== "true") {
				ctx.ui.notify("Not a git repository", "error");
				return;
			}

			// Check if there are any changes
			const statusPorcelain = runGit(["status", "--porcelain"], cwd);
			if (!statusPorcelain) {
				ctx.ui.notify("Nothing to commit, working tree clean", "info");
				return;
			}

			// Determine commit message
			const rawArgs = (args ?? "").trim();
			const commitMessage = rawArgs
				? stripQuotes(rawArgs)
				: generateMessageFromStat(cwd);

			// Stage all changes
			runGit(["add", "-A"], cwd);

			// Commit
			const commitResult = execFileSync("git", ["commit", "-m", commitMessage], {
				cwd,
				encoding: "utf8",
				timeout: 10000,
			}).trim();

			if (!commitResult || commitResult.includes("nothing to commit")) {
				ctx.ui.notify("Nothing to commit after staging", "info");
				return;
			}

			// Push
			if (!hasRemote(cwd)) {
				ctx.ui.notify(`Committed: ${commitMessage}\nNo remote configured, skipping push.`, "info");
				return;
			}

			const branch = getCurrentBranch(cwd);
			const pushArgs = branch ? ["push", "--set-upstream", "origin", branch] : ["push"];
			let pushSuccess = true;
			try {
				execFileSync("git", pushArgs, { cwd, encoding: "utf8", timeout: 30000 });
			} catch {
				pushSuccess = false;
			}

			if (!pushSuccess) {
				ctx.ui.notify(`Committed: ${commitMessage}\nPush failed. Try manual push.`, "warning");
				return;
			}

			// Report result
			const remoteUrl = getRemoteUrl(cwd);
			const isMainBranch = branch === "main" || branch === "master";

			if (isMainBranch || !branch) {
				const displayUrl = remoteUrl ? sshToHttps(remoteUrl).replace(/\.git$/, "") : "";
				const locationHint = displayUrl ? ` → ${displayUrl}` : "";
				ctx.ui.notify(`✓ Pushed to ${branch || "remote"}: ${commitMessage}${locationHint}`, "info");
			} else {
				const prUrl = remoteUrl ? buildPullRequestUrl(remoteUrl, branch) : "";
				const locationHint = prUrl ? `\nCreate PR: ${prUrl}` : "";
				ctx.ui.notify(`✓ Pushed to ${branch}: ${commitMessage}${locationHint}`, "info");
			}
		},
	});
}
