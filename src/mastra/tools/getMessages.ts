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
    messageCount: z.number(),
    uniqueUserCount: z.number(),
    activePeriodsCount: z.number(),
  }),
  execute: async ({ context }) => {

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

      if (!messageData || messageData.length === 0) {
        return { 
          transcript: "No messages found.",
          messageCount: 0,
          uniqueUserCount: 0,
          activePeriodsCount: 0
        };
      }

      // Fetch user details
      const userIds = [...new Set(messageData.map(m => m.userId))];

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

      // Calculate active periods (conversations with messages less than 5 minutes apart)
      const sortedMessages = [...messageData].sort((a, b) => {
        const dateA = new Date(a.createdAt).getTime();
        const dateB = new Date(b.createdAt).getTime();
        return dateA - dateB;
      });

      let activePeriodsCount = 0;
      let currentPeriodMessageCount = 0;
      let lastMessageTime = null;
      
      // 5 minutes in milliseconds
      const ACTIVE_PERIOD_THRESHOLD = 5 * 60 * 1000;

      for (const message of sortedMessages) {
        const currentMessageTime = new Date(message.createdAt).getTime();
        
        if (lastMessageTime === null) {
          // First message
          lastMessageTime = currentMessageTime;
          currentPeriodMessageCount = 1;
        } else {
          const timeDifference = currentMessageTime - lastMessageTime;
          
          if (timeDifference <= ACTIVE_PERIOD_THRESHOLD) {
            // Message is within threshold of previous message
            currentPeriodMessageCount++;
          } else {
            // Gap is too large, check if previous period was active
            if (currentPeriodMessageCount > 1) {
              activePeriodsCount++;
            }
            // Start a new period
            currentPeriodMessageCount = 1;
          }
          
          lastMessageTime = currentMessageTime;
        }
      }
      
      // Check if the last period was active
      if (currentPeriodMessageCount > 1) {
        activePeriodsCount++;
      }

      return { 
        transcript,
        messageCount: messageData.length,
        uniqueUserCount: userIds.length,
        activePeriodsCount
      };
    } catch (error: any) {
      console.error('Error processing messages:', error);
      throw new Error(`Failed to process messages: ${error.message}`);
    }
  },
}); 