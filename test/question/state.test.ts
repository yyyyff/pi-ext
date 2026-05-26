import { describe, expect, test } from "bun:test";
import {
	createQuestionBodyState,
	questionConfirm,
	questionSave,
	questionSelect,
	questionSetSelected,
	questionStoreCustom,
	questionSubmit,
} from "../../extensions/question/state";
import type { QuestionInfo } from "../../extensions/question/types";

function questions(input: Partial<QuestionInfo>[] = [{}]): QuestionInfo[] {
	return input.map((item) => ({
		question: item.question ?? "Mode?",
		header: item.header ?? "Mode",
		options: item.options ?? [{ label: "chunked", description: "Incremental output" }],
		multiple: item.multiple,
		custom: item.custom,
	}));
}

describe("question state machine", () => {
	test("replies immediately for a single-select question", () => {
		const out = questionSelect(createQuestionBodyState(), questions());

		expect(out.answers).toEqual([["chunked"]]);
	});

	test("advances multi-question flows and submits from confirm", () => {
		const ask = questions([
			{
				question: "Mode?",
				header: "Mode",
				options: [{ label: "chunked", description: "Incremental output" }],
			},
			{
				question: "Output?",
				header: "Output",
				options: [
					{ label: "yes", description: "Show tool output" },
					{ label: "no", description: "Hide tool output" },
				],
			},
		]);

		let state = questionSelect(createQuestionBodyState(), ask).state;
		expect(state.tab).toBe(1);

		state = questionSetSelected(state, 1);
		state = questionSelect(state, ask).state;
		expect(questionConfirm(ask, state)).toBe(true);
		expect(questionSubmit(ask, state)).toEqual([["chunked"], ["no"]]);
	});

	test("toggles answers for multiple-choice questions", () => {
		const ask = questions([
			{
				question: "Tags?",
				header: "Tags",
				options: [{ label: "bug", description: "Bug fix" }],
				multiple: true,
			},
		]);

		let state = questionSelect(createQuestionBodyState(), ask).state;
		expect(state.answers).toEqual([["bug"]]);

		state = questionSelect(state, ask).state;
		expect(state.answers).toEqual([[]]);
	});

	test("stores and submits custom answers for single-select questions", () => {
		let state = questionSetSelected(createQuestionBodyState(), 1);
		let next = questionSelect(state, questions());
		expect(next.state.editing).toBe(true);

		state = questionStoreCustom(next.state, 0, "  custom mode  ");
		next = questionSave(state, questions());
		expect(next.answers).toEqual([["custom mode"]]);
	});

	test("stores custom answers for multiple-choice questions", () => {
		const ask = questions([{ multiple: true }]);
		let state = questionSetSelected(createQuestionBodyState(), 1);
		state = questionSelect(state, ask).state;
		expect(state.editing).toBe(true);

		state = questionStoreCustom(state, 0, "  custom mode  ");
		state = questionSave(state, ask).state;
		expect(state.answers).toEqual([["custom mode"]]);
		expect(state.editing).toBe(false);

		state = questionSetSelected(state, 0);
		state = questionSelect(state, ask).state;
		expect(state.answers).toEqual([["custom mode", "chunked"]]);
	});

	test("single multiple-choice question uses confirm instead of immediate submit", () => {
		const ask = questions([{ multiple: true }]);
		const state = questionSelect(createQuestionBodyState(), ask).state;

		expect(questionConfirm(ask, state)).toBe(false);
		expect(questionSubmit(ask, state)).toEqual([["chunked"]]);
	});
});
