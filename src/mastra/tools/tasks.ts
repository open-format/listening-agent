import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage } from "@langchain/core/messages";
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.BRITTNEY_SUPABASE_URL!,
  process.env.BRITTNEY_SUPABASE_KEY!
);

const model = new ChatOpenAI({
  modelName: "gpt-4o",
  temperature: 0.2,
  maxTokens: 4000,
});

export const fetchTasksTool = createTool({
  id: 'fetch-tasks',
  description: 'Fetch existing tasks from the database for a specific community',
  inputSchema: z.object({
    communityId: z.string().uuid(),
  }),
  outputSchema: z.object({
    tasks: z.array(z.object({
      name: z.string(),
      description: z.string(),
    }))
  }),
  execute: async ({ context }) => {
    let query = supabase
      .from('tasks')
      .select('name, description')
      .eq('community_id', context.communityId)

    const { data, error } = await query;

    if (error) {
      console.error('Failed to fetch tasks:', error);
      return { tasks: [] };
    }

    return { tasks: data || [] };
  }
});

export const taskIdentificationTool = createTool({
  id: 'identify-tasks',
  description: 'Identify potential tasks from community discussions and save to database',
  inputSchema: z.object({
    transcript: z.string(),
    communityId: z.string().uuid(),
    existingTasks: z.array(z.object({
      name: z.string(),
      description: z.string(),
    })).optional(),
  }),
  outputSchema: z.object({
    tasks: z.array(z.object({
      name: z.string(),
      description: z.string(),
      required_skills: z.array(z.string()),
      evidence: z.string(),
      type: z.enum(['Feature', 'Documentation', 'Support', 'Infrastructure']),
      requirements: z.object({
        role: z.enum(['team', 'builder', 'ambassador', 'member']),
        access_level: z.enum(['internal', 'trusted', 'public']),
        experience_level: z.enum(['beginner', 'intermediate', 'advanced'])
      })
    }))
  }),
  execute: async ({ context }) => {
    const existingTasksContext = context.existingTasks ? `
Existing tasks (DO NOT recreate these, but if mentioned add to their evidence):
${context.existingTasks.map(task => `- ${task.name}: ${task.description}`).join('\n')}
` : '';

    const prompt = `Analyze this chat transcript and identify potential tasks that could help the community.

${existingTasksContext}

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
${context.transcript}`;

    const response = await model.invoke([new HumanMessage(prompt)]);
    const content = typeof response.content === 'string' 
      ? response.content 
      : JSON.stringify(response.content);

    console.log('Raw AI response:', content);

    let result;
    try {
      const cleaned = content.replace(/```json\n?|```/g, '').trim();
      console.log('Cleaned response:', cleaned);
      result = JSON.parse(cleaned);
      
      if (!result || !Array.isArray(result.tasks)) {
        console.error('Invalid response structure:', result);
        throw new Error('Invalid response structure');
      }
    } catch (error) {
      console.error('Failed to parse AI response:', error);
      result = { tasks: [] };
    }

    // Save tasks to Supabase
    const savedTasks = [];
    for (const task of result.tasks) {
      try {
        console.log('Attempting to save task:', task.name);
        const { data, error } = await supabase
          .from('tasks')
          .insert({
            name: task.name,
            description: task.description,
            required_skills: task.required_skills,
            evidence: task.evidence,
            type: task.type,
            role: task.requirements.role,
            access_level: task.requirements.access_level,
            experience_level: task.requirements.experience_level,
            community_id: context.communityId,
            status: 'open'
          })
          .select()
          .single();

        if (error) {
          console.error('Failed to save task:', {
            taskName: task.name,
            error: error,
            details: error.details,
            message: error.message
          });
        } else {
          console.log('Successfully saved task:', task.name);
          savedTasks.push(data);
        }
      } catch (error) {
        console.error('Exception while saving task:', {
          taskName: task.name,
          error: error
        });
      }
    }

    console.log(`Saved ${savedTasks.length} out of ${result.tasks.length} tasks`);
    return { tasks: result.tasks };
  },
}); 