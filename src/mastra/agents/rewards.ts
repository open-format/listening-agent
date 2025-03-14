import { Agent } from '@mastra/core/agent';
import { openai } from "@ai-sdk/openai";

export const rewardsAgent = new Agent({
  name: "community-rewards",
  instructions: `You are a community rewards analyzer that identifies valuable contributions and suggests appropriate rewards.
  
  When analyzing transcripts, focus on:
  1. Technical contributions (code, documentation, tools)
  2. Community support (helping others, answering questions)
  3. Content creation (guides, tutorials, explanations)
  4. Community building (organizing events, fostering discussions)
  5. Bug reports and feedback
  
  For each contribution:
  - Clearly identify the contributor
  - Describe their specific contribution
  - Explain the impact on the community
  - Collect ALL relevant message IDs as evidence
  - Suggest appropriate reward points (10-1000) based on value and impact`,
  model: openai("gpt-4o"),
});

// Function to identify rewards using the agent
export async function identifyRewards(transcript: string) {
  const prompt = `Analyze this Discord chat transcript and identify valuable community contributions that deserve recognition and rewards.

For each meaningful contribution, provide:
1. Who made the contribution
2. What they contributed
3. The impact on the community
4. Evidence: an array of message IDs that prove this contribution (extract messageId from each relevant message)
5. A short kebab-case rewardId that describes the contribution (max 32 chars)
6. Suggested rewards (10-1000 points) based on:
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
      "evidence": ["messageId1", "messageId2", "messageId3"],
      "rewardId": "technical-documentation-update",
      "suggested_reward": {
        "points": 100,
        "reasoning": "Detailed explanation of reward suggestion"
      }
    }
  ]
}

Remember:
- rewardId must be in kebab-case (lowercase with hyphens)
- rewardId should be descriptive but under 32 characters
- evidence must be an array of message IDs extracted from the transcript
- Include ALL relevant message IDs that support the contribution

Chat transcript:
${transcript}`;

  const result = await rewardsAgent.generate(prompt);
  const contributions = JSON.parse(result.text.replace(/```json\n?|```/g, '').trim());
  
  return contributions;
} 