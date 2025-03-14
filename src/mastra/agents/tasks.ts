import { Agent } from '@mastra/core/agent';
import { openai } from "@ai-sdk/openai";

interface Badge {
  id: string;
  name: string;
  description: string;
  totalAwarded: string;
}

export const taskAgent = new Agent({
  name: "task-identifier",
  instructions: `You are a task identification agent that analyzes community discussions to identify potential tasks and improvements.
  
  When analyzing transcripts, focus on:
  1. Feature requests and suggestions
  2. Documentation needs
  3. Support requirements
  4. Infrastructure improvements
  5. Community tooling needs
  
  For each task:
  - Create a clear, concise name
  - Provide detailed description
  - Identify required badges based on the badge list provided
  - Include supporting evidence
  - Determine appropriate access levels and requirements
  
  When selecting required badges:
  - Only use badges from the provided list
  - Choose badges that demonstrate the skills or achievements needed for the task
  - Consider the badge descriptions to understand their significance
  - Don't require badges unless they are truly relevant to the task`,
  model: openai("gpt-4o"),
});

// Function to identify tasks using the agent
export async function identifyTasks(
  transcript: string, 
  existingTasks: Array<{ name: string; description: string }> = [],
  availableBadges: Badge[] = []
) {
  const existingTasksContext = existingTasks.length > 0 
    ? `\nExisting tasks (DO NOT recreate these, but if mentioned add to their evidence):\n${existingTasks.map(task => `- ${task.name}: ${task.description}`).join('\n')}`
    : '';

  const badgesContext = availableBadges.length > 0
    ? `\nAvailable badges (ONLY use these for required_badges):\n${availableBadges.map(badge => 
        `- ${badge.name}: ${badge.description} (ID: ${badge.id})`
      ).join('\n')}`
    : '\nNo badges available - leave required_badges empty';

  const prompt = `Analyze this chat transcript and identify potential tasks that could help the community.${existingTasksContext}${badgesContext}

For each task, provide:
1. A clear name (max 20 chars)
2. A concise description
3. Required badge or badges (MUST be badge IDs from the available badges list)
4. Evidence: an array of message IDs that support this task (extract messageId from each relevant message)
5. Task type (Feature/Documentation/Support/Infrastructure)
6. Requirements including:
   - role (MUST be one of: team, builder, ambassador, member)
   - access_level (internal, trusted, public)
   - experience_level (beginner, intermediate, advanced)

Return the response in this exact JSON format:
{
  "tasks": [
    {
      "name": "Short Task Name",
      "description": "Task description",
      "required_badges": ["badge_id_1", "badge_id_2"],
      "evidence": ["messageId1", "messageId2", "messageId3"],
      "type": "Feature",
      "requirements": {
        "role": "member",
        "access_level": "public",
        "experience_level": "beginner"
      }
    }
  ]
}

IMPORTANT: 
- role MUST be one of: team, builder, ambassador, member
- name must be 20 characters or less
- type must be one of: Feature, Documentation, Support, Infrastructure
- required_badges must ONLY use IDs from the available badges list
- evidence must be an array of message IDs extracted from the transcript
- Include ALL relevant message IDs that support the task
- DO NOT recreate existing tasks, instead add new evidence to them

Chat transcript:
${transcript}`;

  const result = await taskAgent.generate(prompt);
  const tasks = JSON.parse(result.text.replace(/```json\n?|```/g, '').trim());
  
  return tasks;
} 