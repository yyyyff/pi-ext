export interface QuestionOption {
	/** Display text (1-5 words, concise). Returned to the LLM when selected. */
	label: string;
	/** Explanation of the choice shown under the label. */
	description: string;
}

export interface QuestionInfo {
	/** Complete question text. */
	question: string;
	/** Very short label for tabs and summaries. */
	header: string;
	/** Available choices. */
	options: QuestionOption[];
	/** Allow selecting multiple choices. Defaults to false. */
	multiple?: boolean;
	/** Allow typing a custom answer. Defaults to true. */
	custom?: boolean;
}

export type QuestionAnswer = string[];

export interface QuestionDetails {
	questions: QuestionInfo[];
	answers: QuestionAnswer[];
}

export interface QuestionParams {
	questions: QuestionInfo[];
}
