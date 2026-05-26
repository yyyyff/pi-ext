import type { QuestionAnswer, QuestionInfo } from "./types";

export interface QuestionBodyState {
	tab: number;
	answers: QuestionAnswer[];
	custom: string[];
	selected: number;
	editing: boolean;
}

export interface QuestionStep {
	state: QuestionBodyState;
	answers?: QuestionAnswer[];
}

export function createQuestionBodyState(): QuestionBodyState {
	return {
		tab: 0,
		answers: [],
		custom: [],
		selected: 0,
		editing: false,
	};
}

export function questionSingle(questions: readonly QuestionInfo[]): boolean {
	return questions.length === 1 && questions[0]?.multiple !== true;
}

export function questionTabs(questions: readonly QuestionInfo[]): number {
	return questionSingle(questions) ? 1 : questions.length + 1;
}

export function questionConfirm(questions: readonly QuestionInfo[], state: QuestionBodyState): boolean {
	return !questionSingle(questions) && state.tab === questions.length;
}

export function questionInfo(questions: readonly QuestionInfo[], state: QuestionBodyState): QuestionInfo | undefined {
	return questions[state.tab];
}

export function questionCustom(questions: readonly QuestionInfo[], state: QuestionBodyState): boolean {
	return questionInfo(questions, state)?.custom !== false;
}

export function questionInput(state: QuestionBodyState): string {
	return state.custom[state.tab] ?? "";
}

export function questionPicked(state: QuestionBodyState): boolean {
	const value = questionInput(state);
	if (!value) return false;
	return state.answers[state.tab]?.includes(value) ?? false;
}

export function questionOther(questions: readonly QuestionInfo[], state: QuestionBodyState): boolean {
	const info = questionInfo(questions, state);
	if (!info || info.custom === false) return false;
	return state.selected === info.options.length;
}

export function questionTotal(questions: readonly QuestionInfo[], state: QuestionBodyState): number {
	const info = questionInfo(questions, state);
	if (!info) return 0;
	return info.options.length + (questionCustom(questions, state) ? 1 : 0);
}

export function questionAnswers(state: QuestionBodyState, count: number): QuestionAnswer[] {
	return Array.from({ length: count }, (_, index) => state.answers[index] ?? []);
}

export function questionSetTab(state: QuestionBodyState, tab: number): QuestionBodyState {
	return {
		...state,
		tab,
		selected: 0,
		editing: false,
	};
}

export function questionSetSelected(state: QuestionBodyState, selected: number): QuestionBodyState {
	return {
		...state,
		selected,
	};
}

export function questionSetEditing(state: QuestionBodyState, editing: boolean): QuestionBodyState {
	return {
		...state,
		editing,
	};
}

function storeAnswers(state: QuestionBodyState, tab: number, list: string[]): QuestionBodyState {
	const answers = [...state.answers];
	answers[tab] = list;
	return {
		...state,
		answers,
	};
}

export function questionStoreCustom(state: QuestionBodyState, tab: number, text: string): QuestionBodyState {
	const custom = [...state.custom];
	custom[tab] = text;
	return {
		...state,
		custom,
	};
}

function questionPick(
	state: QuestionBodyState,
	questions: readonly QuestionInfo[],
	answer: string,
	custom = false,
): QuestionStep {
	const answers = [...state.answers];
	answers[state.tab] = [answer];
	let next: QuestionBodyState = {
		...state,
		answers,
		editing: false,
	};

	if (custom) {
		const list = [...state.custom];
		list[state.tab] = answer;
		next = {
			...next,
			custom: list,
		};
	}

	if (questionSingle(questions)) {
		return {
			state: next,
			answers: [[answer]],
		};
	}

	return {
		state: questionSetTab(next, state.tab + 1),
	};
}

function questionToggle(state: QuestionBodyState, answer: string): QuestionBodyState {
	const list = [...(state.answers[state.tab] ?? [])];
	const index = list.indexOf(answer);
	if (index === -1) {
		list.push(answer);
	} else {
		list.splice(index, 1);
	}
	return storeAnswers(state, state.tab, list);
}

export function questionMove(
	state: QuestionBodyState,
	questions: readonly QuestionInfo[],
	dir: -1 | 1,
): QuestionBodyState {
	const total = questionTotal(questions, state);
	if (total === 0) return state;
	return {
		...state,
		selected: (state.selected + dir + total) % total,
	};
}

export function questionSelect(state: QuestionBodyState, questions: readonly QuestionInfo[]): QuestionStep {
	const info = questionInfo(questions, state);
	if (!info) return { state };

	if (questionOther(questions, state)) {
		if (!info.multiple) {
			return { state: questionSetEditing(state, true) };
		}

		const value = questionInput(state);
		if (value && questionPicked(state)) {
			return { state: questionToggle(state, value) };
		}

		return { state: questionSetEditing(state, true) };
	}

	const option = info.options[state.selected];
	if (!option) return { state };

	if (info.multiple) {
		return { state: questionToggle(state, option.label) };
	}

	return questionPick(state, questions, option.label);
}

export function questionSave(state: QuestionBodyState, questions: readonly QuestionInfo[]): QuestionStep {
	const info = questionInfo(questions, state);
	if (!info) return { state };

	const value = questionInput(state).trim();
	const previous = state.custom[state.tab];
	if (!value) {
		if (!previous) {
			return { state: questionSetEditing(state, false) };
		}

		const next = questionStoreCustom(state, state.tab, "");
		return {
			state: questionSetEditing(
				storeAnswers(
					next,
					state.tab,
					(state.answers[state.tab] ?? []).filter((item) => item !== previous),
				),
				false,
			),
		};
	}

	if (info.multiple) {
		const answers = [...(state.answers[state.tab] ?? [])];
		if (previous) {
			const index = answers.indexOf(previous);
			if (index !== -1) answers.splice(index, 1);
		}
		if (!answers.includes(value)) answers.push(value);

		const next = questionStoreCustom(state, state.tab, value);
		return {
			state: questionSetEditing(storeAnswers(next, state.tab, answers), false),
		};
	}

	return questionPick(state, questions, value, true);
}

export function questionSubmit(questions: readonly QuestionInfo[], state: QuestionBodyState): QuestionAnswer[] {
	return questionAnswers(state, questions.length);
}
