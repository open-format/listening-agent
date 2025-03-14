import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.BRITTNEY_SUPABASE_URL!,
  process.env.BRITTNEY_SUPABASE_KEY!
);

export const storePendingRewardTool = createTool({
  id: 'store-pending-reward',
  description: 'Store a pending reward in the database',
  inputSchema: z.object({
    communityId: z.string().uuid(),
    contributor: z.string(),
    walletAddress: z.string().nullable(),
    rewardId: z.string(),
    points: z.number(),
    pointsTokenAddress: z.string(),
    communityAddress: z.string(),
    ipfsHash: z.string(),
    isAutoReward: z.boolean(),
    noWalletAddress: z.boolean()
  }),
  outputSchema: z.object({
    success: z.boolean(),
    id: z.string().uuid().optional(),
    error: z.string().optional()
  }),
  execute: async ({ context }) => {

    try {
      const { data, error } = await supabase
        .from('pending_rewards')
        .insert({
          community_id: context.communityId,
          contributor: context.contributor,
          wallet_address: context.walletAddress,
          reward_id: context.rewardId,
          points: context.points,
          points_token_address: context.pointsTokenAddress,
          community_address: context.communityAddress,
          ipfs_hash: context.ipfsHash,
          is_auto_reward: context.isAutoReward,
          no_wallet_address: context.noWalletAddress
        })
        .select('id')
        .single();

      if (error) {
        console.error('Supabase error storing pending reward:', error);
        console.error('Error details:', {
          code: error.code,
          message: error.message,
          details: error.details
        });
        return {
          success: false,
          error: error.message
        };
      }

      return {
        success: true,
        id: data.id
      };
    } catch (error: any) {
      console.error('Exception in storePendingRewardTool:', error);
      console.error('Stack trace:', error.stack);
      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  }
}); 