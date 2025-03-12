import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.STEVE_SUPABASE_URL!,
  process.env.STEVE_SUPABASE_KEY!
);

export const fetchMessagesTool = createTool({
  id: 'fetch-messages',
  description: 'Fetch messages from Supabase for a specific platform and server',
  inputSchema: z.object({
    startDate: z.string(),
    endDate: z.string(),
    platform: z.enum(['discord', 'telegram']),
    serverId: z.string(),
  }),
  outputSchema: z.object({
    transcript: z.string(),
  }),
  execute: async ({ context }) => {
    console.log('Executing fetchMessages with context:', {
      startDate: context.startDate,
      endDate: context.endDate,
      platform: context.platform,
      serverId: context.serverId
    });

    // Parse the date strings into Date objects
    const startDate = new Date(context.startDate);
    const endDate = new Date(context.endDate);

    // Fetch messages based on platform
    let query = supabase
      .from('memories')
      .select('*')
      .eq('type', 'messages')
      .gte('createdAt', startDate.toISOString())
      .lte('createdAt', endDate.toISOString());

    if (context.platform === 'discord') {
      query = query
        .contains('content', { source: 'discord' })
        .filter('content->>url', 'like', `%/channels/${context.serverId}/%`);
    } else {
      query = query
        .contains('content', { source: 'telegram' })
        .or(`content->server_id.eq.${context.serverId},content->>server_id.eq.${context.serverId}`);
    }

    try {
      const { data: messageData, error: messageError } = await query;
    
      if (messageError) {
        console.error('Error fetching messages:', messageError);
        throw messageError;
      }

      console.log(`Found ${messageData?.length || 0} messages`);

      if (!messageData || messageData.length === 0) {
        return { transcript: "No messages found." };
      }

      // Fetch user details
      const userIds = [...new Set(messageData.map(m => m.userId))];
      console.log(`Found ${userIds.length} unique users`);

      const { data: userData, error: userError } = await supabase
        .from('accounts')
        .select('*')
        .in('id', userIds);

      if (userError) {
        console.error('Error fetching users:', userError);
        throw userError;
      }

      const userMap = (userData || []).reduce((acc, user) => {
        acc[user.id] = user.username || 'Unknown User';
        return acc;
      }, {} as Record<string, string>);

      // Format messages into transcript
      const transcript = messageData
        .map(memory => {
          const username = userMap[memory.userId] || 'Unknown User';
          let datetime;
          try {
            // Use the raw createdAt value directly
            datetime = memory.createdAt;
          } catch (error) {
            console.warn('Invalid date:', memory.createdAt);
            datetime = 'Unknown Date';
          }
          const platform = context.platform;
          const channelInfo = context.platform === 'discord' 
            ? `#${memory.content.url.split('/')[5]}` 
            : `${memory.content.thread_id || 'Unknown Channel'}`;
          
          return `[${datetime}] ${platform}/${channelInfo} ${username}: ${memory.content.text}`;
        })
        .join('\n');

      return { transcript };
    } catch (error: any) {
      console.error('Error processing messages:', error);
      throw new Error(`Failed to process messages: ${error.message}`);
    }
  },
}); 