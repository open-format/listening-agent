import { Agent } from '@mastra/core/agent';
import { openai } from "@ai-sdk/openai";

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
  - Identify required skills
  - Include supporting evidence
  - Determine appropriate access levels and requirements`,
  model: openai("gpt-4o"),
});

// Function to identify tasks using the agent
export async function identifyTasks(transcript: string, existingTasks: Array<{ name: string; description: string }> = []) {
  const existingTasksContext = existingTasks.length > 0 
    ? `\nExisting tasks (DO NOT recreate these, but if mentioned add to their evidence):\n${existingTasks.map(task => `- ${task.name}: ${task.description}`).join('\n')}`
    : '';

  const prompt = `Analyze this chat transcript and identify potential tasks that could help the community.${existingTasksContext}

For each task, provide:
1. A clear name (max 20 chars)
2. A concise description
3. Required skills
4. Evidence from the chat that supports creating this task
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
      "required_skills": ["skill1", "skill2"],
      "evidence": "Evidence from chat",
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
- DO NOT recreate existing tasks, instead add new evidence to them

Chat transcript:
${transcript}`;

  const result = await taskAgent.generate(prompt);
  const tasks = JSON.parse(result.text.replace(/```json\n?|```/g, '').trim());
  
  return tasks;
} 