import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";

const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.2,
  maxTokens: 4000,
});

const REWARD_GUIDELINES = {
  min_points: 10,
  max_points: 1000,
};

export const identifyRewardsTool = createTool({
  id: 'identify-rewards',
  description: 'Identify valuable community contributions and suggest appropriate rewards',
  inputSchema: z.object({
    transcript: z.string(),
  }),
  outputSchema: z.object({
    contributions: z.array(z.object({
      contributor: z.string(),
      description: z.string(),
      impact: z.string(),
      evidence: z.string(),
      suggested_reward: z.object({
        points: z.number(),
        reasoning: z.string()
      })
    }))
  }),
  execute: async ({ context }) => {
    const prompt = `Analyze this Discord chat transcript and identify valuable community contributions that deserve recognition and rewards.

For each meaningful contribution, provide:
1. Who made the contribution
2. What they contributed
3. The impact on the community
4. Evidence from the chat, this should be one or several exact quotes from the transcript
5. Suggested rewards based on:
   - Contribution value and impact
   - Time/effort invested
   - Community benefit
   - Technical complexity

Return the response in this exact JSON format:
{
  "contributions": [
    {
      "contributor": "username",
      "description": "Clear description of contribution",
      "impact": "Specific impact on community",
      "evidence": "Relevant quote or several quotes from chat",
      "suggested_reward": {
        "points": 100,
        "reasoning": "Detailed explanation of reward suggestion"
      }
    }
  ]
}

Reward Guidelines:
- Points: Scale from ${REWARD_GUIDELINES.min_points} to ${REWARD_GUIDELINES.max_points}


Consider these contribution types:
1. Technical contributions (code, documentation, tools)
2. Community support (helping others, answering questions)
3. Content creation (guides, tutorials, explanations)
4. Community building (organizing events, fostering discussions)
5. Bug reports and feedback

Chat transcript:
${context.transcript}`;

    const response = await model.invoke([new HumanMessage(prompt)]);
    const content = typeof response.content === 'string' 
      ? response.content 
      : JSON.stringify(response.content);

    try {
      const result = JSON.parse(content.replace(/```json\n?|```/g, '').trim());
      
      type Contribution = {
        contributor: string;
        description: string;
        impact: string;
        evidence: string;
        suggested_reward: {
          points: number;
          reasoning: string;
        };
      };

      // Validate rewards are within guidelines
      result.contributions = result.contributions.map((contribution: Contribution) => {
        const reward = contribution.suggested_reward;
        return {
          ...contribution,
          suggested_reward: {
            ...reward,
            points: Math.min(Math.max(reward.points, REWARD_GUIDELINES.min_points), REWARD_GUIDELINES.max_points),
          }
        };
      });

      return result;
    } catch (error) {
      console.error('Failed to parse AI response', error);
      return { contributions: [] };
    }
  },
}); 