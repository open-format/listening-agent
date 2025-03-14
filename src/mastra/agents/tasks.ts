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
      "task_scope": "community",
      "urgency_score": 75,
      "impact_score": 80,
      "priority_score": 78,
      "priority_reasoning": "High priority due to X messages mentioning urgency, Y community members supporting",
      "reward_points": 1000,
      "isNewTask": true,
      "taskToUpdateId": null
    }
  ]
}

Scoring Guidelines:
1. Urgency Score (0-100):
   - How time-sensitive is the task?
   - Are there deadlines or dependencies?
   - Is it blocking other work?
   - 80-100: Critical blockers or immediate deadlines (next 24-48 hours)
   - 60-79: Important near-term tasks (this week)
   - 40-59: Standard timeline (this month)
   - 20-39: Long-term improvements (next few months)
   - 0-19: Nice-to-have features (no timeline pressure)

2. Impact Score (0-100):
   - How many community members benefit?
   - Does it affect core functionality?
   - Will it improve engagement/retention?
   - 80-100: Core platform functionality or entire community affected
   - 60-79: Major feature or large user segment affected
   - 40-59: Moderate improvement for regular users
   - 20-39: Minor enhancement or small user segment
   - 0-19: Minimal impact or very specific use case

3. Priority Score:
   - Base score = (Impact * 0.6) + (Urgency * 0.4)
   - Most tasks should fall in 30-60 range
   - Adjust final score by:
     * Number of mentions (+1-3 points per mention)
     * Community support (+1-5 points)
     * Strategic alignment (+1-5 points)
   - Scores above 75 should be rare and justify critical nature

4. Reward Points:
   - Simple tasks (1-2 hours): 100-300 points
   - Small tasks (2-4 hours): 300-500 points
   - Medium tasks (4-8 hours): 500-1000 points
   - Large tasks (multiple days): 1000-2000 points
   - Complex projects (weeks+): 2000-3000 points
   - Adjust based on:
     * Required expertise (-25% to +25%)
     * Strategic importance (+10% to +30%)
     * Time sensitivity (+10% to +20%)

Task Scope:
- community: Tasks that can be completed by community members
- internal: Tasks that require team access or internal knowledge

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
- Be conservative with scores - most tasks should be medium priority
- Only use high scores (75+) for genuinely critical/blocking issues
- Reward points should reflect actual effort required, not perceived importance
- Consider the community's typical point values when setting rewards

Chat transcript:
${transcript}`;

  const result = await taskAgent.generate(prompt);
  const tasks = JSON.parse(result.text.replace(/```json\n?|```/g, '').trim());
  
  return tasks;
} 