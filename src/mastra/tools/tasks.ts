import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.BRITTNEY_SUPABASE_URL!,
  process.env.BRITTNEY_SUPABASE_KEY!
);

export const fetchTasksTool = createTool({
  id: 'fetch-tasks',
  description: 'Fetch existing tasks from the database for a specific community',
  inputSchema: z.object({
    communityId: z.string().uuid(),
  }),
  outputSchema: z.object({
    tasks: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      priority_score: z.number().optional(),
      evidence: z.array(z.string()).optional()
    }))
  }),
  execute: async ({ context }) => {
    const { data, error } = await supabase
      .from('tasks')
      .select('id, name, description, priority_score, evidence')
      .eq('community_id', context.communityId);

    if (error) {
      console.error('Failed to fetch tasks:', error);
      return { tasks: [] };
    }

    return { tasks: data || [] };
  }
});

export const saveTaskTool = createTool({
  id: 'save-task',
  description: 'Save a new task to the database or update existing one',
  inputSchema: z.object({
    communityId: z.string().uuid(),
    name: z.string(),
    description: z.string(),
    required_badges: z.array(z.string()),
    evidence: z.array(z.string()),
    type: z.enum([
      'Feature', 'Documentation', 'Support', 'Infrastructure',
      'Event', 'Workshop', 'Meetup',
      'Content', 'Translation', 'Marketing', 'Design',
      'Research', 'Analysis', 'Strategy',
      'Governance', 'Operations', 'Moderation',
      'Education', 'Onboarding', 'Mentoring'
    ]),
    task_scope: z.enum(['community', 'internal']),
    urgency_score: z.number().min(0).max(100),
    impact_score: z.number().min(0).max(100),
    priority_score: z.number().min(0).max(100),
    priority_reasoning: z.string(),
    reward_points: z.number().min(0),
    status: z.string(),
    isNewTask: z.boolean(),
    taskToUpdateId: z.string().nullable()
  }),
  outputSchema: z.object({
    success: z.boolean(),
    error: z.string().optional()
  }),
  execute: async ({ context }) => {
    const now = new Date().toISOString();

    // Calculate priority decay based on last update
    const calculateDecayedPriority = async (taskId: string, currentPriority: number) => {
      const { data } = await supabase
        .from('tasks')
        .select('updated_at, priority_score')
        .eq('id', taskId)
        .single();
      
      if (data) {
        const daysSinceUpdate = Math.floor((Date.now() - new Date(data.updated_at).getTime()) / (1000 * 60 * 60 * 24));
        // Decay 1 point every 3 days of inactivity, but never below 10
        const decayPoints = Math.floor(daysSinceUpdate / 3);
        return Math.max(10, currentPriority - decayPoints);
      }
      return currentPriority;
    };

    if (!context.isNewTask && context.taskToUpdateId) {
      // Calculate decayed priority before applying new update
      const updatedPriority = await calculateDecayedPriority(context.taskToUpdateId, context.priority_score);

      // Update existing task
      const { error } = await supabase
        .from('tasks')
        .update({
          name: context.name,
          description: context.description,
          required_badges: context.required_badges,
          evidence: context.evidence,
          type: context.type,
          task_scope: context.task_scope,
          urgency_score: context.urgency_score,
          impact_score: context.impact_score,
          priority_score: updatedPriority,
          priority_reasoning: context.priority_reasoning,
          reward_points: context.reward_points,
          status: context.status,
          updated_at: now
        })
        .eq('id', context.taskToUpdateId);

      if (error) {
        console.error('Failed to update task:', error);
        return { success: false, error: error.message };
      }
    } else {
      // Insert new task
      const { error } = await supabase
        .from('tasks')
        .insert({
          community_id: context.communityId,
          name: context.name,
          description: context.description,
          required_badges: context.required_badges,
          evidence: context.evidence,
          type: context.type,
          task_scope: context.task_scope,
          urgency_score: context.urgency_score,
          impact_score: context.impact_score,
          priority_score: context.priority_score,
          priority_reasoning: context.priority_reasoning,
          reward_points: context.reward_points,
          status: context.status,
          created_at: now,
          updated_at: now
        });

      if (error) {
        console.error('Failed to save task:', error);
        return { success: false, error: error.message };
      }
    }

    return { success: true };
  }
});

export const fetchExampleTasksTool = createTool({
  id: 'fetch-example-tasks',
  description: 'Fetch example tasks for a specific community to guide task identification',
  inputSchema: z.object({
    communityId: z.string().uuid(),
  }),
  outputSchema: z.object({
    examples: z.array(z.object({
      name: z.string(),
      description: z.string(),
      type: z.enum([
        'Feature', 'Documentation', 'Support', 'Infrastructure',
        'Event', 'Workshop', 'Meetup',
        'Content', 'Translation', 'Marketing', 'Design',
        'Research', 'Analysis', 'Strategy',
        'Governance', 'Operations', 'Moderation',
        'Education', 'Onboarding', 'Mentoring'
      ]),
      task_scope: z.enum(['community', 'internal']),
      urgency_score: z.number().min(0).max(100),
      impact_score: z.number().min(0).max(100),
      priority_score: z.number().min(0).max(100),
      priority_reasoning: z.string(),
      reward_points: z.number().min(0)
    }))
  }),
  execute: async ({ context }) => {
    const { data, error } = await supabase
      .from('example_tasks')
      .select('*')
      .eq('community_id', context.communityId)
      .limit(5);

    if (error) {
      console.error('Failed to fetch example tasks:', error);
      return { examples: [] };
    }

    return { examples: data || [] };
  }
});