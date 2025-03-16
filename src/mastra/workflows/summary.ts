import { Workflow, Step } from '@mastra/core/workflows';
import { z } from 'zod';
import { saveSummaryTool, fetchMessagesTool, getCommunityProfileTool } from '../tools/index.js';
import { generateSummary } from '../agents/summary.js';

// Define the workflow
export const summaryWorkflow = new Workflow({
  name: 'community-summary',
  triggerSchema: z.object({
    startDate: z.date(),
    endDate: z.date(),
    communityId: z.string().uuid(),
    platform: z.enum(['discord', 'telegram']),
    // Accept a string for channelIds (can be a single ID or JSON array)
    channelIds: z.string().optional().transform(val => {
      if (!val) return undefined;
      
      // If it's a string that looks like a JSON array, try to parse it
      if (val.trim().startsWith('[') && val.trim().endsWith(']')) {
        try {
          const parsed = JSON.parse(val);
          return Array.isArray(parsed) ? parsed : [val];
        } catch (e) {
          console.warn('Failed to parse channelIds as JSON:', e);
          // If parsing fails, use as a single value
          return [val];
        }
      }
      
      // Otherwise treat as a single channel ID
      return [val];
    })
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

      // Ensure channelIds is properly parsed
      let channelIds = context.triggerData.channelIds;
      
      // If channelIds is a string that looks like a JSON array, parse it
      if (typeof channelIds === 'string' && channelIds.trim().startsWith('[') && channelIds.trim().endsWith(']')) {
        try {
          channelIds = JSON.parse(channelIds);
        } catch (e) {
          console.warn('Failed to parse channelIds as JSON:', e);
          // Keep as is if parsing fails
        }
      }

      const result = await fetchMessagesTool.execute({
        context: {
          startDate,
          endDate,
          platform: context.triggerData.platform.toLowerCase(),
          serverId: serverId,
          channelIds: channelIds
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

// Step 3: Generate summary from transcript using the agent
const generateSummaryStep = new Step({
  id: 'generateSummary',
  outputSchema: z.object({
    summary: z.string(),
    summarizationResult: z.any(),
  }),
  execute: async ({ context }) => {
    if (context.steps.fetchMessages.status !== 'success') {
      throw new Error('Failed to fetch messages');
    }

    const transcript = context.steps.fetchMessages.output.transcript;
    
    // Use the agent to generate the summary
    const result = await generateSummary(transcript);
    
    return result;
  },
});

// Step 4: Save the summary to the database
const saveSummaryStep = new Step({
  id: 'saveSummary',
  outputSchema: z.object({
    success: z.boolean(),
    summaryId: z.string().uuid().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    if (context.steps.generateSummary.status !== 'success') {
      throw new Error('Failed to generate summary');
    }
    
    if (context.steps.fetchMessages.status !== 'success') {
      throw new Error('Failed to fetch messages');
    }

    if (!saveSummaryTool.execute) {
      throw new Error('Save summary tool not initialized');
    }

    // Get the start and end dates
    const startDate = typeof context.triggerData.startDate === 'object' 
      ? context.triggerData.startDate.toISOString()
      : context.triggerData.startDate;
    
    const endDate = typeof context.triggerData.endDate === 'object'
      ? context.triggerData.endDate.toISOString()
      : context.triggerData.endDate;

    return saveSummaryTool.execute({
      context: {
        communityId: context.triggerData.communityId,
        summary: context.steps.generateSummary.output.summary,
        startDate,
        endDate,
        platform: context.triggerData.platform.toLowerCase(),
        messageCount: context.steps.fetchMessages.output.messageCount,
        uniqueUserCount: context.steps.fetchMessages.output.uniqueUserCount,
        activePeriodsCount: context.steps.fetchMessages.output.activePeriodsCount,
        summarizationResult: context.steps.generateSummary.output.summarizationResult,
      }
    });
  },
});

// Link the steps together
summaryWorkflow
  .step(getCommunityProfileStep)
  .then(fetchMessagesStep)
  .then(generateSummaryStep)
  .then(saveSummaryStep)
  .commit(); 