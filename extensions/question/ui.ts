import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	Editor,
	type EditorTheme,
	Key,
	matchesKey,
	truncateToWidth,
	wrapTextWithAnsi,
} from "@earendil-works/pi-tui";
import {
	createQuestionBodyState,
	questionConfirm,
	questionCustom,
	questionInfo,
	questionInput,
	questionMove,
	questionOther,
	questionPicked,
	questionSave,
	questionSelect,
	questionSetEditing,
	questionSetSelected,
	questionSetTab,
	questionSingle,
	questionSubmit,
	questionTabs,
	questionTotal,
	type QuestionBodyState,
} from "./state";
import type { QuestionAnswer, QuestionInfo } from "./types";

const CUSTOM_LABEL = "Type your own answer";

export async function askQuestions(
	ctx: ExtensionContext,
	questions: readonly QuestionInfo[],
): Promise<QuestionAnswer[] | null> {
	return await ctx.ui.custom<QuestionAnswer[] | null>((tui, theme, _keybindings, done) => {
		let state = createQuestionBodyState();
		let focused = false;
		let cachedWidth: number | undefined;
		let cachedLines: string[] | undefined;

		const single = () => questionSingle(questions);
		const confirm = () => questionConfirm(questions, state);
		const info = () => questionInfo(questions, state);
		const input = () => questionInput(state);
		const other = () => questionOther(questions, state);
		const picked = () => questionPicked(state);

		const editorTheme: EditorTheme = {
			borderColor: (s: string) => theme.fg("accent", s),
			selectList: {
				selectedPrefix: (text: string) => theme.fg("accent", text),
				selectedText: (text: string) => theme.fg("accent", text),
				description: (text: string) => theme.fg("muted", text),
				scrollInfo: (text: string) => theme.fg("dim", text),
				noMatch: (text: string) => theme.fg("warning", text),
			},
		};
		const editor = new Editor(tui, editorTheme, { paddingX: 0 });

		function invalidate() {
			cachedWidth = undefined;
			cachedLines = undefined;
		}

		function refresh() {
			invalidate();
			tui.requestRender();
		}

		function setState(next: QuestionBodyState) {
			const wasEditing = state.editing;
			state = next;
			if (!wasEditing && state.editing) {
				editor.setText(input());
			}
			editor.focused = focused && state.editing;
			refresh();
		}

		function applyStep(step: { state: QuestionBodyState; answers?: QuestionAnswer[] }) {
			state = step.state;
			editor.focused = focused && state.editing;
			if (step.answers) {
				done(step.answers);
				return;
			}
			refresh();
		}

		editor.onSubmit = (value) => {
			state = questionStoreText(state, value);
			const step = questionSave(state, questions);
			applyStep(step);
		};

		function choose(selected: number) {
			const cur = questionSetSelected(state, selected);
			const step = questionSelect(cur, questions);
			applyStep(step);
		}

		function selectCurrent() {
			const step = questionSelect(state, questions);
			applyStep(step);
		}

		function setTab(tab: number) {
			setState(questionSetTab(state, tab));
		}

		function move(dir: -1 | 1) {
			setState(questionMove(state, questions, dir));
		}

		function submit() {
			done(questionSubmit(questions, state));
		}

		function reject() {
			done(null);
		}

		function handleInput(data: string) {
			if (state.editing) {
				if (matchesKey(data, Key.escape)) {
					setState(questionSetEditing(state, false));
					return;
				}
				if (matchesKey(data, Key.enter)) {
					state = questionStoreText(state, editor.getText());
					const step = questionSave(state, questions);
					applyStep(step);
					return;
				}
				editor.handleInput(data);
				state = questionStoreText(state, editor.getText());
				refresh();
				return;
			}

			if (!single() && (matchesKey(data, Key.left) || data === "h")) {
				setTab((state.tab - 1 + questionTabs(questions)) % questionTabs(questions));
				return;
			}
			if (!single() && (matchesKey(data, Key.right) || data === "l")) {
				setTab((state.tab + 1) % questionTabs(questions));
				return;
			}
			if (!single() && (matchesKey(data, Key.tab) || matchesKey(data, Key.shift("tab")))) {
				const dir = matchesKey(data, Key.shift("tab")) ? -1 : 1;
				setTab((state.tab + dir + questionTabs(questions)) % questionTabs(questions));
				return;
			}

			if (confirm()) {
				if (matchesKey(data, Key.enter)) {
					submit();
					return;
				}
				if (matchesKey(data, Key.escape)) {
					reject();
				}
				return;
			}

			const total = questionTotal(questions, state);
			const digit = data.length === 1 ? Number(data) : Number.NaN;
			if (Number.isInteger(digit) && digit >= 1 && digit <= Math.min(total, 9)) {
				choose(digit - 1);
				return;
			}

			if (matchesKey(data, Key.up) || data === "k") {
				move(-1);
				return;
			}
			if (matchesKey(data, Key.down) || data === "j") {
				move(1);
				return;
			}
			if (matchesKey(data, Key.enter)) {
				selectCurrent();
				return;
			}
			if (matchesKey(data, Key.escape)) {
				reject();
			}
		}

		function addWrapped(lines: string[], text: string, width: number, prefix = "") {
			const available = Math.max(1, width - visiblePlainWidth(prefix));
			const wrapped = wrapTextWithAnsi(text, available);
			for (const line of wrapped.length ? wrapped : [""]) {
				lines.push(truncateToWidth(prefix + line, width));
			}
		}

		function renderTabs(lines: string[], width: number) {
			if (single()) return;
			const parts: string[] = [];
			for (let i = 0; i < questions.length; i++) {
				const question = questions[i];
				const active = state.tab === i;
				const answered = (state.answers[i]?.length ?? 0) > 0;
				const box = answered ? "■" : "□";
				const label = ` ${box} ${question?.header ?? `Q${i + 1}`} `;
				parts.push(active ? theme.bg("selectedBg", theme.fg("text", label)) : theme.fg(answered ? "success" : "muted", label));
			}
			const confirmLabel = " ✓ Confirm ";
			parts.push(confirm() ? theme.bg("selectedBg", theme.fg("text", confirmLabel)) : theme.fg("muted", confirmLabel));
			lines.push(truncateToWidth(` ${parts.join(" ")}`, width));
			lines.push("");
		}

		function renderConfirm(lines: string[], width: number) {
			lines.push(theme.fg("accent", theme.bold(" Review")));
			lines.push("");
			for (let i = 0; i < questions.length; i++) {
				const question = questions[i];
				const answer = state.answers[i] ?? [];
				const label = theme.fg("muted", `${question?.header ?? `Question ${i + 1}`}: `);
				const value = answer.length ? theme.fg("text", answer.join(", ")) : theme.fg("error", "(not answered)");
				addWrapped(lines, label + value, width, " ");
			}
		}

		function renderOptions(lines: string[], width: number) {
			const current = info();
			if (!current) return;

			for (let i = 0; i < current.options.length; i++) {
				const option = current.options[i];
				if (!option) continue;
				const active = state.selected === i;
				const hit = state.answers[state.tab]?.includes(option.label) ?? false;
				const marker = current.multiple ? `[${hit ? "✓" : " "}] ` : "";
				const prefix = active ? theme.fg("accent", "> ") : "  ";
				const number = theme.fg(active ? "accent" : "muted", `${i + 1}. `);
				const labelColor = active ? "accent" : hit ? "success" : "text";
				const check = !current.multiple && hit ? theme.fg("success", " ✓") : "";
				addWrapped(lines, `${number}${theme.fg(labelColor, `${marker}${option.label}`)}${check}`, width, prefix);
				if (option.description) {
					addWrapped(lines, theme.fg("muted", option.description), width, "     ");
				}
			}

			if (questionCustom(questions, state)) {
				const currentOptions = current.options.length;
				const active = other();
				const isPicked = picked();
				const marker = current.multiple ? `[${isPicked ? "✓" : " "}] ` : "";
				const prefix = active ? theme.fg("accent", "> ") : "  ";
				const number = theme.fg(active ? "accent" : "muted", `${currentOptions + 1}. `);
				const labelColor = active ? "accent" : isPicked ? "success" : "text";
				const check = !current.multiple && isPicked ? theme.fg("success", " ✓") : "";
				addWrapped(lines, `${number}${theme.fg(labelColor, `${marker}${CUSTOM_LABEL}`)}${check}`, width, prefix);

				if (state.editing) {
					for (const line of renderBorderlessEditor(editor, Math.max(1, width - 5))) {
						lines.push(truncateToWidth(`     ${line}`, width));
					}
				} else if (input()) {
					addWrapped(lines, theme.fg("muted", input()), width, "     ");
				}
			}
		}

		function render(width: number): string[] {
			const safeWidth = Math.max(1, width);
			if (cachedLines && cachedWidth === safeWidth) return cachedLines;

			const lines: string[] = [];
			const border = theme.fg("accent", "─".repeat(safeWidth));
			lines.push(border);
			renderTabs(lines, safeWidth);

			if (confirm()) {
				renderConfirm(lines, safeWidth);
			} else {
				const current = info();
				if (current) {
					const suffix = current.multiple ? theme.fg("muted", " (select all that apply)") : "";
					addWrapped(lines, theme.fg("text", current.question) + suffix, safeWidth, " ");
					lines.push("");
					renderOptions(lines, safeWidth);
				}
			}

			lines.push("");
			if (state.editing) {
				lines.push(truncateToWidth(theme.fg("dim", " enter save   esc cancel"), safeWidth));
			} else if (confirm()) {
				lines.push(truncateToWidth(theme.fg("dim", " enter submit   esc dismiss"), safeWidth));
			} else if (single()) {
				lines.push(truncateToWidth(theme.fg("dim", " ↑↓ select   enter submit   esc dismiss"), safeWidth));
			} else {
				const verb = info()?.multiple ? "toggle" : "confirm";
				lines.push(truncateToWidth(theme.fg("dim", ` ⇆ tab   ↑↓ select   enter ${verb}   esc dismiss`), safeWidth));
			}
			lines.push(border);

			cachedWidth = safeWidth;
			cachedLines = lines.map((line) => truncateToWidth(line, safeWidth));
			return cachedLines;
		}

		return {
			get focused() {
				return focused;
			},
			set focused(value: boolean) {
				focused = value;
				editor.focused = focused && state.editing;
			},
			render,
			handleInput,
			invalidate,
		};
	});
}

function questionStoreText(state: QuestionBodyState, text: string): QuestionBodyState {
	const custom = [...state.custom];
	custom[state.tab] = text;
	return { ...state, custom };
}

function renderBorderlessEditor(editor: Editor, width: number): string[] {
	const lines = editor.render(width);
	if (lines.length <= 2) return [""];
	return lines.slice(1, -1);
}

function visiblePlainWidth(value: string): number {
	// Prefixes used here are short and may contain ANSI. truncateToWidth handles
	// the final safety bound; this only keeps wrapping roughly aligned.
	return value.replace(/\x1b\[[0-9;]*m/g, "").length;
}
