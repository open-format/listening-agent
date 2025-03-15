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

Your role is to:
1. Identify valuable tasks that could benefit the community
2. Ensure tasks are well-defined and actionable
3. Consider both technical and non-technical contributions
4. Balance urgency with long-term strategic value
5. Use community examples as guidance when available

Focus on these contribution categories:

Technical:
- Feature development
- Documentation
- Technical support
- Infrastructure improvements

Community:
- Events and workshops
- Community building
- Meetups and gatherings
- Member engagement

Content:
- Educational content
- Marketing materials
- Translations
- Design work

Strategy:
- Research and analysis
- Planning initiatives
- Process improvements
- Community surveys

Core principles:
- Tasks should be clear and achievable
- Evidence should link directly to community discussions
- Required badges should match task requirements
- Scoring should be consistent and justified
- Similar tasks should be merged, not duplicated
- Community examples should guide task structure`,
  model: openai("gpt-4o"),
});

// Function to identify tasks using the agent
export async function identifyTasks(
  transcript: string, 
  existingTasks: Array<{ id: string; name: string; description: string }> = [],
  availableBadges: Badge[] = [],
  exampleTasks: Array<{
    name: string;
    description: string;
    type: string;
    task_scope: string;
    urgency_score: number;
    impact_score: number;
    priority_score: number;
    priority_reasoning: string;
    reward_points: number;
  }> = []
) {
  const existingTasksContext = existingTasks.length > 0 
    ? `\nExisting tasks (DO NOT recreate these, but if mentioned add to their evidence):\n${existingTasks.map(task => `- ${task.name} (ID: ${task.id}): ${task.description}`).join('\n')}`
    : '';

  const badgesContext = availableBadges.length > 0
    ? `\nAvailable badges (ONLY use these for required_badges):\n${availableBadges.map(badge => 
        `- ${badge.name}: ${badge.description} (ID: ${badge.id})`
      ).join('\n')}`
    : '\nNo badges available - leave required_badges empty';

  const examplesContext = exampleTasks.length > 0
    ? `\nExample tasks for this community (use these as a reference for scoring and structure):\n${exampleTasks.map(task => 
        `Example Task:
        - Name: ${task.name}
        - Description: ${task.description}
        - Type: ${task.type}
        - Scope: ${task.task_scope}
        - Urgency Score: ${task.urgency_score}
        - Impact Score: ${task.impact_score}
        - Priority Score: ${task.priority_score}
        - Priority Reasoning: ${task.priority_reasoning}
        - Reward Points: ${task.reward_points}`
      ).join('\n\n')}`
    : '';

  const prompt = `Analyze this chat transcript and identify potential tasks that could help the community.${existingTasksContext}${badgesContext}${examplesContext}

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
   - Education: Education, Onboarding, Mentoring
   - Business Growth: Growth Opportunities, Community Building, Ambassador)
6. Task scope (MUST be one of):
   - community: Tasks that can be completed by community members
   - internal: Tasks that require team access or internal knowledge
7. Scoring (all scores must be 0-100):
   - urgency_score: Time sensitivity and blocking nature
   - impact_score: Community benefit and strategic value
   - priority_score: Calculated from urgency and impact
   - priority_reasoning: Clear explanation of the scores
8. Reward points: Points awarded for task completion
9. Task identification:
   - isNewTask: true if this is a new task
   - taskToUpdateId: ID of existing task if this is an update (null if new)

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
    In general you should use the examples provided to you as a reference for the reward points.
    Based on the priority, impact and urgency scores of the example tasks you should scale the reward points accordingly.
    Don't copy the exact reward_points values, but they should heavily influence the reward points you set.
    Generally the more urgent, impactful and complex the task the higher the reward points.
    If there are no or insufficient examples for you to use, use the following scoring system:
   - Simple tasks (1-2 hours): 100-300 points
   - Small tasks (2-4 hours): 300-500 points
   - Medium tasks (4-8 hours): 500-1000 points
   - Large tasks (multiple days): 1000-2000 points


Task Scope:
- community: Tasks that can be completed by community members
- internal: Tasks that require team access or internal knowledge

IMPORTANT: 
- name must be 20 characters or less
- type must be one of the specified task types
- task_scope must be either 'community' or 'internal'
- required_badges must ONLY use IDs from the available badges list
- evidence must be an array of message IDs extracted from the transcript
- Include ALL relevant message IDs that support the task
- All scores (urgency, impact, priority) must be between 0-100
- Priority score must follow the formula: (Impact * 0.6) + (Urgency * 0.4)
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
- Be conservative with scores - most tasks should be medium priority (30-60 range)
- Only use high scores (75+) for genuinely critical/blocking issues
- Reward points should reflect actual effort required, not perceived importance
- Use example tasks (if provided) as reference for appropriate scoring and reward points
- Follow the reward points guidelines based on estimated completion time
- Consider the community's typical point values when setting rewards

Chat transcript:
${transcript}`;

  const result = await taskAgent.generate(prompt);
  const tasks = JSON.parse(result.text.replace(/```json\n?|```/g, '').trim());
  
  return tasks;
} 