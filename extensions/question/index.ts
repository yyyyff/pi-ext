import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import {
	createQuestionDetails,
	formatAnswerForDisplay,
	formatAnswersForLLM,
	normalizeQuestions,
	prepareQuestionArguments,
	validateQuestions,
} from "./format";
import { askQuestions } from "./ui";
import type { QuestionDetails, QuestionParams } from "./types";

const TOOL_DESCRIPTION = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- When \`custom\` is enabled (default), a "Type your own answer" option is added automatically; don't include "Other" or catch-all options
- Answers are returned as arrays of labels; set \`multiple: true\` to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`;

const OptionSchema = Type.Object({
	label: Type.String({ description: "Display text (1-5 words, concise)" }),
	description: Type.String({ description: "Explanation of choice" }),
});

const QuestionSchema = Type.Object({
	question: Type.String({ description: "Complete question" }),
	header: Type.String({ description: "Very short label (max 30 chars)" }),
	options: Type.Array(OptionSchema, { description: "Available choices" }),
	multiple: Type.Optional(Type.Boolean({ description: "Allow selecting multiple choices" })),
	custom: Type.Optional(Type.Boolean({ description: "Allow typing a custom answer (default: true)" })),
});

const QuestionParameters = Type.Object({
	questions: Type.Array(QuestionSchema, { description: "Questions to ask" }),
});

export default function questionExtension(pi: ExtensionAPI) {
	pi.registerTool({
		name: "question",
		label: "Question",
		description: TOOL_DESCRIPTION,
		promptSnippet: "Ask the user questions during execution",
		parameters: QuestionParameters,
		prepareArguments: prepareQuestionArguments,

		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				throw new Error("Question tool requires an interactive UI");
			}

			const input = params as QuestionParams;
			const questions = normalizeQuestions(input.questions);
			validateQuestions(questions);

			const answers = await askQuestions(ctx, questions);
			if (!answers) {
				throw new Error("The user dismissed this question");
			}

			return {
				content: [{ type: "text" as const, text: formatAnswersForLLM(questions, answers) }],
				details: createQuestionDetails(questions, answers),
			};
		},

		renderCall(args, theme, _context) {
			const count = Array.isArray(args.questions) ? args.questions.length : 0;
			const text = theme.fg("toolTitle", theme.bold("question ")) + theme.fg("muted", `Asked ${count} question${count === 1 ? "" : "s"}`);
			return new Text(text, 0, 0);
		},

		renderResult(result, _options, theme, _context) {
			const details = result.details as QuestionDetails | undefined;
			if (!details?.questions) {
				const first = result.content[0];
				return new Text(first?.type === "text" ? first.text : "", 0, 0);
			}

			const lines: string[] = [theme.fg("muted", "# Questions")];
			for (let i = 0; i < details.questions.length; i++) {
				const question = details.questions[i];
				if (!question) continue;
				if (i > 0) lines.push("");
				lines.push(theme.fg("muted", question.question));
				lines.push(theme.fg("text", formatAnswerForDisplay(details.answers[i])));
			}

			return new Text(lines.join("\n"), 0, 0);
		},
	});
}
