import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.BRITTNEY_SUPABASE_URL!,
  process.env.BRITTNEY_SUPABASE_KEY!
);

export const getCommunityProfileTool = createTool({
  id: 'get-community-profile',
  description: 'Fetch community profile from Supabase using community ID',
  inputSchema: z.object({
    communityId: z.string().uuid(),
  }),
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
    updated_at: z.string().datetime()
  }).nullable(),
  execute: async ({ context }) => {
    try {
      const { data, error } = await supabase
        .from('community_profiles')
        .select('*')
        .eq('id', context.communityId)
        .single();

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