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
  
  When analyzing transcripts, focus on all types of community contributions:
  
  Technical Value:
  - Feature development and improvements
  - Documentation and guides
  - Technical support and troubleshooting
  - Infrastructure and tooling
  
  Community Building:
  - Event organization and hosting
  - Workshop facilitation
  - Meetup coordination
  - Community gatherings
  
  Content & Marketing:
  - Content creation (articles, videos, podcasts)
  - Translations and localization
  - Marketing campaigns and promotion
  - Visual design and branding
  
  Research & Strategy:
  - Community research and surveys
  - Data analysis and insights
  - Strategic planning and initiatives
  
  Governance & Operations:
  - Governance proposals and voting
  - Operational improvements
  - Community moderation
  
  Education & Growth:
  - Educational content and courses
  - Onboarding new members
  - Mentoring and guidance
  
  For each task:
  - Create a clear, concise name
  - Provide detailed description
  - Identify required badges based on the badge list provided
  - Include supporting evidence (message IDs)
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
  existingTasks: Array<{ id: string; name: string; description: string }> = [],
  availableBadges: Badge[] = []
) {
  const existingTasksContext = existingTasks.length > 0 
    ? `\nExisting tasks (DO NOT recreate these, but if mentioned add to their evidence):\n${existingTasks.map(task => `- ${task.name} (ID: ${task.id}): ${task.description}`).join('\n')}`
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
5. Task type (MUST be one of:
   - Technical: Feature, Documentation, Support, Infrastructure
   - Community: Event, Workshop, Meetup
   - Content: Content, Translation, Marketing, Design
   - Research: Research, Analysis, Strategy
   - Governance: Governance, Operations, Moderation
   - Education: Education, Onboarding, Mentoring)
6. Priority score (0-100) based on:
   - Urgency (time-sensitive tasks score higher)
   - Impact (number of people affected)
   - Frequency (how often it's mentioned)
   - Evidence strength (more supporting messages = higher score)
   - Community demand (multiple people requesting/supporting)
7. Requirements including:
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
      "type": "Event",
      "priority_score": 75,
      "priority_reasoning": "High priority due to X messages mentioning urgency, Y community members supporting, and upcoming deadline",
      "requirements": {
        "role": "member",
        "access_level": "public",
        "experience_level": "beginner"
      },
      "isNewTask": true,
      "taskToUpdateId": null
    }
  ]
}

Priority Score Guidelines:
90-100: CRITICAL - Immediate attention required, blocking issues, or severe community impact
70-89: HIGH - Important tasks with significant impact but not immediately critical
50-69: MEDIUM - Standard priority tasks with clear value but no immediate urgency
30-49: LOW - Tasks that would be beneficial but aren't time-sensitive
0-29: BACKLOG - Nice-to-have improvements or long-term ideas

When calculating priority scores, consider:
- Start with a base score in the 30-50 range for most tasks
- Add points for:
  * Urgency (+10-20)
  * Number of community members affected (+5-15)
  * Frequency of mentions (+5-10)
  * Supporting evidence (+2 per piece of evidence)
  * Multiple community members requesting (+5-10)
- Only use scores 90+ for truly critical/blocking issues
- Most new tasks should fall in the 30-70 range initially

IMPORTANT: 
- role MUST be one of: team, builder, ambassador, member
- name must be 20 characters or less
- type must be one of the specified task types
- required_badges must ONLY use IDs from the available badges list
- evidence must be an array of message IDs extracted from the transcript
- Include ALL relevant message IDs that support the task
- Priority score must be justified with clear reasoning
- DO NOT recreate existing tasks, instead add new evidence to them
- When a task is mentioned again, this should influence its priority score
- For each task, determine if it's truly new or an update to an existing task
- Set isNewTask to false and provide taskToUpdateId if the task is similar to an existing one
- Compare task descriptions, types, and purposes to identify similar tasks
- When updating a task, merge new evidence with existing evidence
- Consider tasks similar if they address the same goal/problem even if worded differently
- When updating an existing task, use its ID (provided in parentheses) as taskToUpdateId
- taskToUpdateId must be the exact ID of the task being updated, not its name
- Set isNewTask to false when providing a taskToUpdateId

Chat transcript:
${transcript}`;

  const result = await taskAgent.generate(prompt);
  const tasks = JSON.parse(result.text.replace(/```json\n?|```/g, '').trim());
  
  return tasks;
} 