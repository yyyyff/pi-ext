import { describe, expect, test } from "bun:test";
import {
	createQuestionDetails,
	formatAnswerForDisplay,
	formatAnswersForLLM,
	normalizeQuestions,
	prepareQuestionArguments,
	validateQuestions,
} from "../../extensions/question/format";
import type { QuestionInfo } from "../../extensions/question/types";

const base: QuestionInfo[] = [
	{
		question: "Which framework should we use?",
		header: "Framework",
		options: [
			{ label: "React (Recommended)", description: "Most common choice" },
			{ label: "Vue", description: "Progressive framework" },
		],
	},
	{
		question: "Which checks should run?",
		header: "Checks",
		options: [
			{ label: "lint", description: "Run linter" },
			{ label: "test", description: "Run tests" },
		],
		multiple: true,
		custom: false,
	},
];

describe("question formatting", () => {
	test("normalizes defaults", () => {
		const questions = normalizeQuestions(base);

		expect(questions[0]?.multiple).toBe(false);
		expect(questions[0]?.custom).toBe(true);
		expect(questions[1]?.multiple).toBe(true);
		expect(questions[1]?.custom).toBe(false);
	});

	test("formats LLM output like opencode", () => {
		const questions = normalizeQuestions(base);
		const text = formatAnswersForLLM(questions, [["React (Recommended)"], ["lint", "test"]]);

		expect(text).toBe(
			'User has answered your questions: "Which framework should we use?"="React (Recommended)", "Which checks should run?"="lint, test". You can now continue with the user\'s answers in mind.',
		);
	});

	test("marks unanswered questions", () => {
		const questions = normalizeQuestions(base);
		const text = formatAnswersForLLM(questions, [["React (Recommended)"], []]);

		expect(text).toContain('"Which checks should run?"="Unanswered"');
		expect(formatAnswerForDisplay([])).toBe("(no answer)");
	});

	test("creates structured details", () => {
		const questions = normalizeQuestions(base);
		const details = createQuestionDetails(questions, [["React (Recommended)"], ["lint"]]);

		expect(details).toEqual({
			questions,
			answers: [["React (Recommended)"], ["lint"]],
		});
	});

	test("prepareArguments tolerates string options and missing headers", () => {
		const prepared = prepareQuestionArguments({
			questions: [
				{
					question: "Pick package manager?",
					options: ["pnpm", "npm"],
				},
			],
		});

		expect(prepared).toEqual({
			questions: [
				{
					question: "Pick package manager?",
					header: "Pick package manager?",
					options: [
						{ label: "pnpm", description: "" },
						{ label: "npm", description: "" },
					],
				},
			],
		});
	});

	test("validation rejects empty selectable questions", () => {
		const questions = normalizeQuestions([
			{
				question: "Proceed?",
				header: "Proceed",
				options: [],
				custom: false,
			},
		]);

		expect(() => validateQuestions(questions)).toThrow("at least one option");
	});
});
