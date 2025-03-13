import { Workflow, Step } from '@mastra/core/workflows';
import { z } from 'zod';
import { fetchMessagesTool } from '../tools/getMessages.js';
import { identifyRewardsTool } from '../tools/rewards.js';
import { getCommunityProfileTool } from '../tools/communityProfile.js';
import { getTokensAndBadgesTool } from '../tools/getTokensAndBadges.js';

// Define the workflow
export const rewardsWorkflow = new Workflow({
  name: 'community-rewards',
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
    community_address: z.string(),
    reward_actions: z.array(z.object({  
      type: z.string(),
      points: z.number()
    })),
    created_at: z.string(),
    updated_at: z.string()
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

// Step 1a: Get tokens and badges
const getTokensAndBadgesStep = new Step({
  id: 'getTokensAndBadges',
  outputSchema: z.object({
    success: z.boolean(),
    badges: z.array(z.object({
      id: z.string(),
      name: z.string(),
      description: z.string(),
      totalAwarded: z.string()
    })).optional(),
    tokens: z.array(z.object({
      id: z.string(),
      name: z.string()
    })).optional(),
    error: z.string().optional()
  }),
  execute: async ({ context }) => {
    if (!getTokensAndBadgesTool.execute) {
      throw new Error('Get tokens and badges tool not initialized');
    }
    
    if (context.steps.getCommunityProfile.status !== 'success') {
      throw new Error('Failed to get community profile');
    }

    const profile = context.steps.getCommunityProfile.output;
    return getTokensAndBadgesTool.execute({
      context: {
        communityAddress: profile.community_address
      }
    });
  },
});

// Step 2: Fetch messages using profile data
const fetchMessagesStep = new Step({
  id: 'fetchMessages',
  outputSchema: z.object({
    transcript: z.string(),
    messageCount: z.number(),
    uniqueUserCount: z.number(),
    activePeriodsCount: z.number()
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

// Step 3: Identify rewards from transcript
const identifyRewardsStep = new Step({
  id: 'identifyRewards',
  outputSchema: z.object({
    contributions: z.array(z.object({
      contributor: z.string(),
      description: z.string(),
      impact: z.string(),
      evidence: z.string(),
      suggested_reward: z.object({
        points: z.number(),
        reasoning: z.string()
      })
    }))
  }),
  execute: async ({ context }) => {
    if (!identifyRewardsTool.execute) {
      throw new Error('Rewards identification tool not initialized');
    }
    if (context.steps.fetchMessages.status !== 'success') {
      throw new Error('Failed to fetch messages');
    }

    return identifyRewardsTool.execute({
      context: {
        transcript: context.steps.fetchMessages.output.transcript,
      }
    });
  },
});

// Link the steps together
rewardsWorkflow
  .step(getCommunityProfileStep)
  .then(getTokensAndBadgesStep)
  .then(fetchMessagesStep)
  .then(identifyRewardsStep)
  .commit(); 