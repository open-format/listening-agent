import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.BRITTNEY_SUPABASE_URL!,
  process.env.BRITTNEY_SUPABASE_KEY!
);

export const getCommunityProfileTool = createTool({
  id: 'get-community-profile',
  description: 'Fetch community profile from Supabase using community ID or server ID + platform',
  inputSchema: z.object({
    communityId: z.string().uuid().optional(),
    serverId: z.string().optional(),
    platform: z.enum(['discord', 'telegram']).optional(),
  }).refine(data => 
    (data.communityId !== undefined) || (data.serverId !== undefined && data.platform !== undefined),
    {
      message: "Either communityId or both serverId and platform must be provided"
    }
  ),
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
    })),
    created_at: z.string().datetime(),
    updated_at: z.string().datetime(),
    community_address: z.string(),
    minimum_reward_points: z.number().default(10),
    maximum_reward_points: z.number().default(1000)
  }).nullable(),
  execute: async ({ context }) => {
    try {
      let query = supabase
        .from('community_profiles')
        .select('*');

      // Get by communityId if provided
      if (context.communityId) {
        query = query.eq('id', context.communityId);
      } 
      // Otherwise get by serverId + platform
      else if (context.serverId && context.platform) {
        const serverIdField = context.platform === 'discord' 
          ? 'discord_server_id' 
          : 'telegram_server_id';
        
        query = query.eq(serverIdField, context.serverId);
      }

      // Get single result
      const { data, error } = await query.single();

      if (error) {
        console.error('Failed to fetch community profile:', error);
        return null;
      }

      // Parse JSONB reward_actions into proper format
      const profile = {
        ...data,
        reward_actions: Array.isArray(data.reward_actions) ? data.reward_actions : []
      };

      return profile;
    } catch (error) {
      console.error('Error fetching community profile:', error);
      return null;
    }
  },
}); 