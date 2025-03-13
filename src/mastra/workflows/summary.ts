import { Workflow, Step } from '@mastra/core/workflows';
import { z } from 'zod';
import { fetchMessagesTool } from '../tools/getMessages.js';
import { communitySummaryTool } from '../tools/summary.js';
import { getCommunityProfileTool } from '../tools/communityProfile.js';

// Define the workflow
export const summaryWorkflow = new Workflow({
  name: 'community-summary',
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

      const result = await fetchMessagesTool.execute({
        context: {
          startDate,
          endDate,
          platform: context.triggerData.platform.toLowerCase(),
          serverId: serverId
        }
      });

      return result;
    } catch (error: any) {
      console.error('Error in fetchMessagesStep:', error);
      // Instead of throwing, return a transcript indicating no messages
      return {
        transcript: `No messages found. Note: ${error.message}`,
        messageCount: 0,
        uniqueUserCount: 0,
        activePeriodsCount: 0
      };
    }
  },
});

// Step 3: Generate summary from transcript
const generateSummaryStep = new Step({
  id: 'generateSummary',
  outputSchema: z.object({
    summary: z.string(),
  }),
  execute: async ({ context }) => {
    if (!communitySummaryTool.execute) {
      throw new Error('Summary tool not initialized');
    }
    if (context.steps.fetchMessages.status !== 'success') {
      throw new Error('Failed to fetch messages');
    }

    return communitySummaryTool.execute({
      context: {
        transcript: context.steps.fetchMessages.output.transcript,
      }
    });
  },
});

// Link the steps together
summaryWorkflow
  .step(getCommunityProfileStep)
  .then(fetchMessagesStep)
  .then(generateSummaryStep)
  .commit(); 