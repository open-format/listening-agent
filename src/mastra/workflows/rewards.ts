import { Workflow, Step } from '@mastra/core/workflows';
import { z } from 'zod';
import { fetchMessagesTool, getCommunityProfileTool, getTokensAndBadgesTool, getWalletAddressTool, rewardTokenTool, storePendingRewardTool } from '../tools/index.js';
import { identifyRewards } from '../agents/rewards.js';
import { ThirdwebStorage } from "@thirdweb-dev/storage";

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
      evidence: z.array(z.string()),
      rewardId: z.string().max(32),
      suggested_reward: z.object({
        points: z.number(),
        reasoning: z.string()
      })
    }))
  }),
  execute: async ({ context }) => {
    if (context.steps.fetchMessages.status !== 'success') {
      throw new Error('Failed to fetch messages');
    }

    return identifyRewards(context.steps.fetchMessages.output.transcript);
  },
});

// Step 4: Get wallet addresses for contributors
const getWalletAddressesStep = new Step({
  id: 'getWalletAddresses',
  outputSchema: z.object({
    contributorsWithWallets: z.array(z.object({
      contributor: z.string(),
      description: z.string(),
      impact: z.string(),
      rewardId: z.string().max(32),
      evidence: z.array(z.string()),
      suggested_reward: z.object({
        points: z.number(),
        reasoning: z.string()
      }),
      walletAddress: z.string().nullable(),
      error: z.string().optional()
    }))
  }),
  execute: async ({ context }) => {
    if (!getWalletAddressTool.execute) {
      throw new Error('Get wallet address tool not initialized');
    }
    const getWalletAddress = getWalletAddressTool.execute!;

    if (context.steps.identifyRewards.status !== 'success') {
      throw new Error('Failed to identify rewards');
    }

    const { contributions } = context.steps.identifyRewards.output;
    const platform = context.triggerData.platform.toLowerCase() as 'discord' | 'telegram';

    // Process each contributor to get their wallet address
    const contributorsWithWallets = await Promise.all(
      contributions.map(async (contribution: {
        contributor: string;
        description: string;
        impact: string;
        evidence: string[];
        rewardId: string;
        suggested_reward: {
          points: number;
          reasoning: string;
        }
      }) => {
        const walletInfo = await getWalletAddress({
          context: {
            username: contribution.contributor,
            platform,
            userId: contribution.contributor // Using username as userId since we don't have actual userId
          }
        });

        return {
          ...contribution,
          walletAddress: walletInfo.walletAddress,
          error: walletInfo.error
        };
      })
    );

    return {
      contributorsWithWallets
    };
  }
});

// Step 5: Reward tokens to eligible contributors
const rewardTokensStep = new Step({
  id: 'rewardTokens',
  outputSchema: z.object({
    rewards: z.array(z.object({
      contributor: z.string(),
      walletAddress: z.string(),
      points: z.number(),
      success: z.boolean(),
      transactionHash: z.string().optional(),
      error: z.string().optional()
    })),
    messages: z.array(z.string())
  }),
  execute: async ({ context }) => {
    if (context.steps.getCommunityProfile.status !== 'success' ||
        context.steps.getTokensAndBadges.status !== 'success' ||
        context.steps.getWalletAddresses.status !== 'success') {
      throw new Error('Required steps not completed successfully');
    }

    const profile = context.steps.getCommunityProfile.output;
    const tokensAndBadges = context.steps.getTokensAndBadges.output;
    const { contributorsWithWallets } = context.steps.getWalletAddresses.output;

    // Get the first available token address
    const pointsTokenAddress = tokensAndBadges.tokens?.[0]?.id;
    if (!pointsTokenAddress) {
      throw new Error('No token address available for rewards');
    }

    // Process rewards for each contributor
    const rewards = [];
    const messages = [];
    
    for (const contributor of contributorsWithWallets) {
      try {
        // Generate IPFS hash first as we'll need it for both immediate and pending rewards
        const ipfsHash = await uploadJSONToIPFS({
          description: contributor.description,
          impact: contributor.impact,
          evidence: contributor.evidence,
          reasoning: contributor.suggested_reward.reasoning,
          platform: context.triggerData.platform,
          auto_rewards: profile.auto_rewards_enabled
        });

        // Branch 1: Store as pending if no wallet address
        if (!contributor.walletAddress) {
          if (!storePendingRewardTool.execute) {
            throw new Error('Store pending reward tool not initialized');
          }
          
          const pendingResult = await storePendingRewardTool.execute({
            context: {
              communityId: profile.id,
              contributor: contributor.contributor,
              walletAddress: null,
              rewardId: contributor.rewardId,
              points: contributor.suggested_reward.points,
              pointsTokenAddress,
              communityAddress: profile.community_address,
              ipfsHash,
              isAutoReward: profile.auto_rewards_enabled,
              noWalletAddress: true
            }
          });

          rewards.push({
            contributor: contributor.contributor,
            walletAddress: null,
            points: contributor.suggested_reward.points,
            success: pendingResult.success,
            error: pendingResult.error
          });

          messages.push(`Stored pending reward for ${contributor.contributor} (no wallet address)`);
          continue;
        }

        // Branch 2: Store as pending if auto-rewards disabled
        if (!profile.auto_rewards_enabled) {
          if (!storePendingRewardTool.execute) {
            throw new Error('Store pending reward tool not initialized');
          }
          
          const pendingResult = await storePendingRewardTool.execute({
            context: {
              communityId: profile.id,
              contributor: contributor.contributor,
              walletAddress: contributor.walletAddress,
              rewardId: contributor.rewardId,
              points: contributor.suggested_reward.points,
              pointsTokenAddress,
              communityAddress: profile.community_address,
              ipfsHash,
              isAutoReward: false,
              noWalletAddress: false
            }
          });

          rewards.push({
            contributor: contributor.contributor,
            walletAddress: contributor.walletAddress,
            points: contributor.suggested_reward.points,
            success: pendingResult.success,
            error: pendingResult.error
          });

          messages.push(`Stored pending reward for ${contributor.contributor} (manual approval required)`);
          continue;
        }

        // Branch 3: Process immediate reward if has wallet and auto-rewards enabled
        if (!rewardTokenTool.execute) {
          throw new Error('Reward token tool not initialized');
        }

        const result = await rewardTokenTool.execute({
          context: {
            receiver: contributor.walletAddress,
            rewardId: contributor.rewardId,
            points: contributor.suggested_reward.points,
            pointsTokenAddress,
            communityAddress: profile.community_address,
            ipfsHash
          }
        });

        rewards.push({
          contributor: contributor.contributor,
          walletAddress: contributor.walletAddress,
          points: contributor.suggested_reward.points,
          ...result
        });

        if (result.success) {
          messages.push(`${contributor.contributor} was awarded ${contributor.suggested_reward.points} points - ${result.transactionHash}`);
        } else {
          messages.push(`Failed to reward ${contributor.contributor}: ${result.error}`);
        }

      } catch (error: any) {
        console.error('Error processing reward:', error);
        rewards.push({
          contributor: contributor.contributor,
          walletAddress: contributor.walletAddress || null,
          points: contributor.suggested_reward.points,
          success: false,
          error: error.message
        });
        messages.push(`Error processing reward for ${contributor.contributor}: ${error.message}`);
      }
    }

    return { rewards, messages };
  }
});

// Link the steps together
rewardsWorkflow
  .step(getCommunityProfileStep)
  .then(getTokensAndBadgesStep)
  .then(fetchMessagesStep)
  .then(identifyRewardsStep)
  .then(getWalletAddressesStep)
  .then(rewardTokensStep)
  .commit(); 