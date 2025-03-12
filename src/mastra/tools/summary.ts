import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.2,
  maxTokens: 4000,
});

export const communitySummaryTool = createTool({
  id: 'summarize-community',
  description: 'Generate a concise summary of community discussions',
  inputSchema: z.object({
    transcript: z.string(),
  }),
  outputSchema: z.object({
    summary: z.string(),
  }),
  execute: async ({ context }) => {
    const prompt = `Analyze this conversation transcript and provide a concise and informative 6-10 line summary of the key community activities and discussions.

Focus on subjects such as:
1. Main topics of discussion
2. Important decisions or conclusions reached
3. Notable community interactions or events

Keep the summary clear, informative, and to the point. Each line should convey a distinct and meaningful insight.

Chat transcript:
${context.transcript}`;

    const response = await model.invoke([new HumanMessage(prompt)]);
    const summary = typeof response.content === 'string' 
      ? response.content 
      : JSON.stringify(response.content);

    return { summary: summary.trim() };
  },
}); 