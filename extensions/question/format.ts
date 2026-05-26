import type { QuestionAnswer, QuestionDetails, QuestionInfo, QuestionOption } from "./types";

const DEFAULT_CUSTOM = true;

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function asString(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function fallbackHeader(question: string, index: number): string {
	const trimmed = question.replace(/\s+/g, " ").trim();
	if (!trimmed) return `Question ${index + 1}`;
	return trimmed.length <= 30 ? trimmed : `${trimmed.slice(0, 29)}…`;
}

function prepareOption(option: unknown): unknown {
	if (typeof option === "string") {
		return { label: option, description: "" };
	}
	if (!isRecord(option)) return option;
	return {
		...option,
		label: asString(option.label),
		description: asString(option.description),
	};
}

function prepareQuestion(question: unknown, index: number): unknown {
	if (!isRecord(question)) return question;
	const text = asString(question.question);
	return {
		...question,
		question: text,
		header: asString(question.header, fallbackHeader(text, index)),
		options: Array.isArray(question.options) ? question.options.map(prepareOption) : [],
	};
}

/**
 * Compatibility shim for common model mistakes before TypeBox validation.
 * The public schema remains strict; this only normalizes obviously intended values.
 */
export function prepareQuestionArguments(args: unknown): unknown {
	if (!isRecord(args)) return args;
	return {
		...args,
		questions: Array.isArray(args.questions) ? args.questions.map(prepareQuestion) : args.questions,
	};
}

export function normalizeQuestions(input: readonly QuestionInfo[]): QuestionInfo[] {
	return input.map((question, index) => ({
		question: question.question.trim(),
		header: (question.header || fallbackHeader(question.question, index)).trim(),
		options: question.options.map((option): QuestionOption => ({
			label: option.label.trim(),
			description: option.description.trim(),
		})),
		multiple: question.multiple === true,
		custom: question.custom === false ? false : DEFAULT_CUSTOM,
	}));
}

export function validateQuestions(questions: readonly QuestionInfo[]): void {
	if (questions.length === 0) {
		throw new Error("No questions provided");
	}

	for (let i = 0; i < questions.length; i++) {
		const question = questions[i];
		if (!question) continue;
		const label = question.header || `Question ${i + 1}`;
		if (!question.question) {
			throw new Error(`${label}: question text is required`);
		}
		const selectable = question.options.length + (question.custom !== false ? 1 : 0);
		if (selectable === 0) {
			throw new Error(`${label}: at least one option is required when custom answers are disabled`);
		}
		for (let j = 0; j < question.options.length; j++) {
			const option = question.options[j];
			if (!option?.label) {
				throw new Error(`${label}: option ${j + 1} label is required`);
			}
		}
	}
}

export function formatAnswersForLLM(questions: readonly QuestionInfo[], answers: readonly QuestionAnswer[]): string {
	const formatted = questions
		.map((question, index) => {
			const answer = answers[index];
			return `"${question.question}"="${answer?.length ? answer.join(", ") : "Unanswered"}"`;
		})
		.join(", ");

	return `User has answered your questions: ${formatted}. You can now continue with the user's answers in mind.`;
}

export function createQuestionDetails(
	questions: readonly QuestionInfo[],
	answers: readonly QuestionAnswer[],
): QuestionDetails {
	return {
		questions: questions.map((question) => ({
			question: question.question,
			header: question.header,
			options: question.options.map((option) => ({ ...option })),
			multiple: question.multiple === true,
			custom: question.custom === false ? false : DEFAULT_CUSTOM,
		})),
		answers: questions.map((_, index) => [...(answers[index] ?? [])]),
	};
}

export function formatAnswerForDisplay(answer: readonly string[] | undefined): string {
	return answer?.length ? answer.join(", ") : "(no answer)";
}
