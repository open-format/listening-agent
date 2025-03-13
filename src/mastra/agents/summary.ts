import { Agent } from '@mastra/core/agent';
import { openai } from "@ai-sdk/openai";
import { SummarizationMetric } from "@mastra/evals/llm";

export const summaryAgent = new Agent({
  name: "community-summarizer",
  instructions: `You are a community summarizer that creates concise, informative summaries of community discussions.
  
  When analyzing transcripts, focus on:
  1. Main topics of discussion
  2. Important decisions or conclusions reached
  3. Notable community interactions or events
  
  Keep summaries clear, informative, and to the point. Each line should convey a distinct and meaningful insight.`,
  model: openai("gpt-4o"),
  evals: {
    summarization: new SummarizationMetric(openai("gpt-4o")),
  },
});

// Function to generate a summary using the agent
export async function generateSummary(transcript: string) {
  const prompt = `Analyze this conversation transcript and provide a concise and informative 6-10 line summary of the key community activities and discussions.

Chat transcript:
${transcript}`;

  const result = await summaryAgent.generate(prompt);
  const summary = result.text.trim();
  
  // Run the evaluation separately
  const evalResult = await summaryAgent.evals.summarization.measure(transcript, summary);
  const summarizationResult = evalResult;

  
  return {
    summary,
    summarizationResult
  };
} 