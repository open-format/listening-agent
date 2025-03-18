import { Workflow, Step } from '@mastra/core/workflows';
import { z } from 'zod';
import { 
  getCommunityProfileTool, 
  fetchMessageByIdTool, 
  rewardTokenTool, 
  getWalletAddressTool,
  storePendingRewardTool,
  getTokensAndBadgesTool,
  getRewardsTool
} from '../tools/index.js';
import { evaluateMessage } from '../agents/rewards.js';
import { ThirdwebStorage } from "@thirdweb-dev/storage";

// Define Reward interface
interface Reward {
  rewardId: string;
  userId: string;
  type: 'badge' | 'token';
  badgeName?: string;
  tokenName?: string;
  tokenAmount?: string;
  name?: string;
  description?: string;
  impact?: string;
  reasoning?: string;
  image?: string;
  minimum_reward_points?: number;
  maximum_reward_points?: number;
}

const storage = new ThirdwebStorage({
  secretKey: process.env.THIRDWEB_SECRET,
});

async function uploadJSONToIPFS(data: Record<string, unknown>) {
  const ipfsHash = await storage.upload(data, {
    uploadWithoutDirectory: true,
  });
  return ipfsHash;
}

// Define the workflow
export const messageRewardWorkflow = new Workflow({
  name: 'message-reward',
  triggerSchema: z.object({
    messageId: z.string().uuid(),
    platform: z.enum(['discord', 'telegram']),
  }),
});

// Step 1: Fetch the message
const fetchMessageStep = new Step({
  id: 'fetchMessage',
  outputSchema: z.object({
    id: z.string().uuid(),
    content: z.object({
      text: z.string(),
      source: z.enum(['discord', 'telegram']),
      url: z.string().optional(),
      server_id: z.string().optional(),
      thread_id: z.string().optional(),
      channel_id: z.string().optional(),
    }),
    createdAt: z.string(),
    userId: z.string(),
    username: z.string().nullable(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    if (!fetchMessageByIdTool.execute) {
      throw new Error('Fetch message tool not initialized');
    }
    
    const result = await fetchMessageByIdTool.execute({
      context: {
        messageId: context.triggerData.messageId
      }
    });
    
    if (result.error) {
      throw new Error(`Failed to fetch message: ${result.error}`);
    }
    
    return result;
  },
});

// Step 2: Get community profile
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
    updated_at: z.string(),
    minimum_reward_points: z.number().default(10),
    maximum_reward_points: z.number().default(1000)
  }),
  execute: async ({ context }) => {
    if (!getCommunityProfileTool.execute) {
      throw new Error('Community profile tool not initialized');
    }
    
    if (context.steps.fetchMessage.status !== 'success') {
      throw new Error('Failed to fetch message');
    }
    
    // Get the server ID from the message
    const message = context.steps.fetchMessage.output;
    const serverId = message.content.server_id;
    const platform = context.triggerData.platform;
    
    if (!serverId) {
      throw new Error('No server ID found in message');
    }
    
    const profile = await getCommunityProfileTool.execute({
      context: {
        serverId,
        platform
      }
    });
    
    if (!profile) {
      throw new Error('Community profile not found');
    }
    
    return profile;
  },
});

// Step 3: Get tokens and badges
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

// New Step: Get recent rewards
const getRewardsStep = new Step({
  id: 'getRewards',
  outputSchema: z.object({
    success: z.boolean(),
    rewards: z.array(z.object({
      rewardId: z.string(),
      userId: z.string(),
      type: z.enum(['badge', 'token']),
      badgeName: z.string().optional(),
      tokenName: z.string().optional(),
      tokenAmount: z.string().optional(),
      name: z.string().optional(),
      description: z.string().optional(),
      impact: z.string().optional(),
      reasoning: z.string().optional(),
      image: z.string().optional(),
      minimum_reward_points: z.number().optional(),
      maximum_reward_points: z.number().optional(),
    })),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    if (!getRewardsTool.execute) {
      throw new Error('Get rewards tool not initialized');
    }
    
    if (context.steps.getCommunityProfile.status !== 'success') {
      throw new Error('Failed to get community profile');
    }
    
    const profile = context.steps.getCommunityProfile.output;
    
    try {
      const rewardsResult = await getRewardsTool.execute({
        context: {
          communityAddress: profile.community_address
        }
      });
      
      return rewardsResult;
    } catch (error) {
      console.warn('Error fetching rewards:', error);
      return {
        success: false,
        rewards: [],
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }
});

// Step 4: Evaluate message
const evaluateMessageStep = new Step({
  id: 'evaluateMessage',
  outputSchema: z.object({
    contributions: z.array(z.object({
      description: z.string(),
      impact: z.string(),
      rewardId: z.string(),
      suggested_reward: z.object({
        points: z.number(),
        reasoning: z.string()
      })
    }))
  }),
  execute: async ({ context }) => {
    if (context.steps.fetchMessage.status !== 'success') {
      throw new Error('Failed to fetch message');
    }
    
    if (context.steps.getCommunityProfile.status !== 'success') {
      throw new Error('Failed to get community profile');
    }
    
    const message = context.steps.fetchMessage.output;
    const profile = context.steps.getCommunityProfile.output;
    
    // Get community min/max reward points settings
    const minPoints = profile.minimum_reward_points || 10;
    const maxPoints = profile.maximum_reward_points || 1000;
    
    // Format reward examples from the dedicated step
    let rewardExamples = "";
    if (context.steps.getRewards.status === 'success' && 
        context.steps.getRewards.output.success && 
        context.steps.getRewards.output.rewards.length > 0) {
      
      // Filter to only token rewards and format them as examples
      const tokenRewards = context.steps.getRewards.output.rewards
        .filter((reward: Reward) => reward.type === 'token')
        .slice(0, 10);
      
      if (tokenRewards.length > 0) {
        rewardExamples = "\n\nRecent reward examples from this community:\n" + 
          tokenRewards.map((reward: Reward) => {
            let example = `Reward ID: ${reward.rewardId}\nPoints: ${reward.tokenAmount}`;
            if (reward.description) example += `\nDescription: ${reward.description}`;
            if (reward.impact) example += `\nImpact: ${reward.impact}`;
            if (reward.reasoning) example += `\nReasoning: ${reward.reasoning}`;
            if (reward.minimum_reward_points) example += `\nAt the point this reward was given the minimum available reward points was: ${reward.minimum_reward_points}`;
            if (reward.maximum_reward_points) example += `\nAt the point this reward was given the maximum available reward points was: ${reward.maximum_reward_points}`;
            return example;
          }).join("\n\n");
      }
    }
    
    // Pass message text, min/max points, and reward examples to the agent
    return evaluateMessage(
      message.content.text,
      minPoints,
      maxPoints,
      rewardExamples
    );
  },
});

// Step 5: Get wallet address
const getWalletAddressStep = new Step({
  id: 'getWalletAddress',
  outputSchema: z.object({
    username: z.string(),
    platform: z.enum(['discord', 'telegram']),
    walletAddress: z.string().nullable(),
    error: z.string().optional()
  }),
  execute: async ({ context }) => {
    if (!getWalletAddressTool.execute) {
      throw new Error('Get wallet address tool not initialized');
    }
    
    if (context.steps.fetchMessage.status !== 'success') {
      throw new Error('Failed to fetch message');
    }
    
    if (context.steps.evaluateMessage.status !== 'success' || 
        context.steps.evaluateMessage.output.contributions.length === 0) {
      return {
        username: context.steps.fetchMessage.output.username || 'Unknown User',
        platform: context.triggerData.platform,
        walletAddress: null,
        error: 'No contribution to reward'
      };
    }
    
    const message = context.steps.fetchMessage.output;
    const platform = context.triggerData.platform;
    
    return getWalletAddressTool.execute({
      context: {
        username: message.username || 'Unknown User',
        platform
      }
    });
  },
});

// Step 6: Process reward
const processRewardStep = new Step({
  id: 'processReward',
  outputSchema: z.object({
    success: z.boolean(),
    transactionHash: z.string().optional(),
    error: z.string().optional(),
    message: z.string()
  }),
  execute: async ({ context }) => {
    if (context.steps.evaluateMessage.status !== 'success' || 
        context.steps.evaluateMessage.output.contributions.length === 0) {
      return {
        success: false,
        message: 'No contribution to reward'
      };
    }
    
    if (context.steps.getCommunityProfile.status !== 'success' ||
        context.steps.getTokensAndBadges.status !== 'success' ||
        context.steps.getWalletAddress.status !== 'success' ||
        context.steps.fetchMessage.status !== 'success') {
      throw new Error('Required steps not completed successfully');
    }
    
    const profile = context.steps.getCommunityProfile.output;
    const tokensAndBadges = context.steps.getTokensAndBadges.output;
    const walletInfo = context.steps.getWalletAddress.output;
    const contribution = context.steps.evaluateMessage.output.contributions[0];
    const message = context.steps.fetchMessage.output;
    
    // Get the first available token address
    const pointsTokenAddress = tokensAndBadges.tokens?.[0]?.id;
    if (!pointsTokenAddress) {
      throw new Error('No token address available for rewards');
    }
    
    try {
      // Generate IPFS hash
      const ipfsHash = await uploadJSONToIPFS({
        messageId: message.id,
        description: contribution.description,
        impact: contribution.impact,
        reasoning: contribution.suggested_reward.reasoning,
        platform: context.triggerData.platform,
        auto_rewards: profile.auto_rewards_enabled,
        minimum_reward_points: profile.minimum_reward_points,
        maximum_reward_points: profile.maximum_reward_points
      });
      
      // Branch 1: Store as pending if no wallet address
      if (!walletInfo.walletAddress) {
        if (!storePendingRewardTool.execute) {
          throw new Error('Store pending reward tool not initialized');
        }
        
        const pendingResult = await storePendingRewardTool.execute({
          context: {
            communityId: profile.id,
            contributor: message.username || 'Unknown User',
            walletAddress: null,
            rewardId: contribution.rewardId,
            points: contribution.suggested_reward.points,
            pointsTokenAddress,
            communityAddress: profile.community_address,
            ipfsHash,
            isAutoReward: profile.auto_rewards_enabled,
            noWalletAddress: true
          }
        });
        
        return {
          success: pendingResult.success,
          error: pendingResult.error,
          message: `Stored pending reward for ${message.username || 'Unknown User'} (no wallet address)`
        };
      }
      
      // Branch 2: Store as pending if auto-rewards disabled
      if (!profile.auto_rewards_enabled) {
        if (!storePendingRewardTool.execute) {
          throw new Error('Store pending reward tool not initialized');
        }
        
        const pendingResult = await storePendingRewardTool.execute({
          context: {
            communityId: profile.id,
            contributor: message.username || 'Unknown User',
            walletAddress: walletInfo.walletAddress,
            rewardId: contribution.rewardId,
            points: contribution.suggested_reward.points,
            pointsTokenAddress,
            communityAddress: profile.community_address,
            ipfsHash,
            isAutoReward: false,
            noWalletAddress: false
          }
        });
        
        return {
          success: pendingResult.success,
          error: pendingResult.error,
          message: `Stored pending reward for ${message.username || 'Unknown User'} (manual approval required)`
        };
      }
      
      // Branch 3: Process immediate reward
      if (!rewardTokenTool.execute) {
        throw new Error('Reward token tool not initialized');
      }
      
      const result = await rewardTokenTool.execute({
        context: {
          receiver: walletInfo.walletAddress,
          rewardId: contribution.rewardId,
          points: contribution.suggested_reward.points,
          pointsTokenAddress,
          communityAddress: profile.community_address,
          ipfsHash
        }
      });
      
      return {
        ...result,
        message: result.success 
          ? `${message.username || 'Unknown User'} was awarded ${contribution.suggested_reward.points} points - ${result.transactionHash}`
          : `Failed to reward ${message.username || 'Unknown User'}: ${result.error}`
      };
      
    } catch (error: any) {
      console.error('Error processing reward:', error);
      return {
        success: false,
        error: error.message,
        message: `Error processing reward: ${error.message}`
      };
    }
  }
});


messageRewardWorkflow
  .step(fetchMessageStep)
  .then(getCommunityProfileStep)
  .then(getTokensAndBadgesStep)
  .then(getRewardsStep)
  .then(evaluateMessageStep)
  .then(getWalletAddressStep)
  .then(processRewardStep)
  .commit(); 