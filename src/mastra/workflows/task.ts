import { Workflow, Step } from '@mastra/core/workflows';
import { z } from 'zod';
import { fetchTasksTool, saveTaskTool, getCommunityProfileTool, fetchMessagesTool, getTokensAndBadgesTool } from '../tools/index.js';
import { identifyTasks } from '../agents/tasks.js';

// Define the workflow
export const taskWorkflow = new Workflow({
  name: 'community-tasks',
  triggerSchema: z.object({
    startDate: z.date(),
    endDate: z.date(),
    communityId: z.string().uuid(),
    platform: z.enum(['discord', 'telegram']),
  }),
});

// Step 1: Get community profile
const getCommunityProfileStep = new Step({
  id: 'getCommunityProfile',
  outputSchema: z.object({
    id: z.string().uuid(),
    name: z.string(),
    description: z.string(),
    goals: z.array(z.string()),
    discord_server_id: z.string().nullable(),
    telegram_server_id: z.string().nullable(),
    github_repos: z.array(z.string()),
    community_address: z.string(),
    auto_rewards_enabled: z.boolean(),
    reward_actions: z.array(z.object({
      type: z.string(),
      points: z.number()
    }))
  }),
  execute: async ({ context }) => {
    if (!getCommunityProfileTool.execute) {
      throw new Error('Community profile tool not initialized');
    }
    const profile = await getCommunityProfileTool.execute({
      context: {
        communityId: context.triggerData.communityId
      }
    });
    if (!profile) {
      throw new Error('Community profile not found');
    }
    return profile;
  },
});

// Add new step after getCommunityProfile
const getTokensAndBadgesStep = new Step({
  id: 'getTokensAndBadges',
  outputSchema: z.object({
    badges: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      totalAwarded: z.string()
    })),
    tokens: z.array(z.object({
      id: z.string(),
      name: z.string()
    }))
  }),
  execute: async ({ context }) => {
    if (!getTokensAndBadgesTool.execute) {
      throw new Error('Get tokens and badges tool not initialized');
    }

    if (context.steps.getCommunityProfile.status !== 'success') {
      throw new Error('Failed to get community profile');
    }

    const result = await getTokensAndBadgesTool.execute({
      context: {
        communityAddress: context.steps.getCommunityProfile.output.community_address
      }
    });

    if (!result.success) {
      throw new Error(result.error || 'Failed to fetch tokens and badges');
    }

    return {
      badges: result.badges || [],
      tokens: result.tokens || []
    };
  },
});

// Step 2: Fetch messages using profile data
const fetchMessagesStep = new Step({
  id: 'fetchMessages',
  outputSchema: z.object({
    transcript: z.string(),
    messageCount: z.number(),
    uniqueUserCount: z.number(),
    activePeriodsCount: z.number(),
  }),
  execute: async ({ context }) => {
    if (!fetchMessagesTool.execute) {
      throw new Error('Fetch messages tool not initialized');
    }
    
    if (context.steps.getCommunityProfile.status !== 'success') {
      throw new Error('Failed to get community profile');
    }
    
    const profile = context.steps.getCommunityProfile.output;
    let serverId;
    
    if (context.triggerData.platform.toLowerCase() === 'discord') {
      serverId = profile.discord_server_id;
    } else {
      serverId = profile.telegram_server_id;
    }

    if (!serverId) {
      throw new Error(`No ${context.triggerData.platform} server ID found for this community`);
    }

    try {
      // Handle both Date objects and ISO string dates
      const startDate = typeof context.triggerData.startDate === 'object' 
        ? context.triggerData.startDate.toISOString()
        : context.triggerData.startDate;
      
      const endDate = typeof context.triggerData.endDate === 'object'
        ? context.triggerData.endDate.toISOString()
        : context.triggerData.endDate;

      console.log('Fetching messages with params:', {
        startDate,
        endDate,
        platform: context.triggerData.platform.toLowerCase(),
        serverId,
        serverIdType: typeof serverId,
        platformCase: context.triggerData.platform
      });

      return fetchMessagesTool.execute({
        context: {
          startDate,
          endDate,
          platform: context.triggerData.platform.toLowerCase(),
          serverId: serverId
        }
      });
    } catch (error: any) {
      console.error('Error in fetchMessagesStep:', error);
      return {
        transcript: `No messages found. Note: ${error.message}`,
        messageCount: 0,
        uniqueUserCount: 0,
        activePeriodsCount: 0
      };
    }
  },
});

// Step 3: Fetch existing tasks
const fetchTasksStep = new Step({
  id: 'fetchTasks',
  outputSchema: z.object({
    tasks: z.array(z.object({
      name: z.string(),
      description: z.string(),
    }))
  }),
  execute: async ({ context }) => {
    if (!fetchTasksTool.execute) {
      throw new Error('Fetch tasks tool not initialized');
    }

    if (context.steps.getCommunityProfile.status !== 'success') {
      throw new Error('Failed to get community profile');
    }

    return fetchTasksTool.execute({
      context: {
        communityId: context.triggerData.communityId,
      }
    });
  },
});

// Step 4: Identify tasks from transcript using the agent
const identifyTasksStep = new Step({
  id: 'identifyTasks',
  outputSchema: z.object({
    tasks: z.array(z.object({
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
      priority_score: z.number().min(0).max(100),
      priority_reasoning: z.string(),
      requirements: z.object({
        role: z.enum(['team', 'builder', 'ambassador', 'member']),
        access_level: z.enum(['internal', 'trusted', 'public']),
        experience_level: z.enum(['beginner', 'intermediate', 'advanced'])
      }),
      isNewTask: z.boolean(),
      taskToUpdateId: z.string().nullable()
    }))
  }),
  execute: async ({ context }) => {
    if (context.steps.fetchMessages.status !== 'success') {
      throw new Error('Failed to fetch messages');
    }
    if (context.steps.fetchTasks.status !== 'success') {
      throw new Error('Failed to fetch existing tasks');
    }
    if (context.steps.getTokensAndBadges.status !== 'success') {
      throw new Error('Failed to fetch tokens and badges');
    }

    const tasks = await identifyTasks(
      context.steps.fetchMessages.output.transcript,
      context.steps.fetchTasks.output.tasks,
      context.steps.getTokensAndBadges.output.badges
    );

    // Save tasks to database using saveTaskTool
    if (tasks.tasks && tasks.tasks.length > 0) {
      try {
        for (const task of tasks.tasks) {
          if (!saveTaskTool.execute) {
            throw new Error('Save task tool not initialized');
          }
          await saveTaskTool.execute({
            context: {
              communityId: context.triggerData.communityId,
              name: task.name,
              description: task.description,
              required_badges: task.required_badges,
              evidence: task.evidence,
              type: task.type,
              role: task.requirements.role,
              access_level: task.requirements.access_level,
              experience_level: task.requirements.experience_level,
              status: 'open',
              priority_score: task.priority_score,
              isNewTask: task.isNewTask,
              taskToUpdateId: task.taskToUpdateId
            }
          });
        }
      } catch (error) {
        console.error('Error saving tasks:', error);
      }
    }

    return tasks;
  },
});

// Update workflow chain
taskWorkflow
  .step(getCommunityProfileStep)
  .then(getTokensAndBadgesStep)
  .then(fetchMessagesStep)
  .then(fetchTasksStep)
  .then(identifyTasksStep)
  .commit();