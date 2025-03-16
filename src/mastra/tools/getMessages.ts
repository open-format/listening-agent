import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.STEVE_SUPABASE_URL!,
  process.env.STEVE_SUPABASE_KEY!
);

export const fetchMessagesTool = createTool({
  id: 'fetch-messages',
  description: 'Fetch messages from Supabase for a specific platform and server, optionally filtered by channels',
  inputSchema: z.object({
    startDate: z.string(),
    endDate: z.string(),
    platform: z.enum(['discord', 'telegram']),
    serverId: z.string(),
    channelIds: z.union([
      z.string(),
      z.array(z.string())
    ]).optional(),
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

    // Ensure channelIds is properly parsed
    let channelIds;
    
    if (context.channelIds) {
      // If it's already an array, use it
      if (Array.isArray(context.channelIds)) {
        channelIds = context.channelIds.filter(id => id && typeof id === 'string');
      } 
      // If it's a string that looks like a JSON array, parse it
      else if (typeof context.channelIds === 'string' && 
               context.channelIds.trim().startsWith('[') && 
               context.channelIds.trim().endsWith(']')) {
        try {
          const parsed = JSON.parse(context.channelIds);
          channelIds = Array.isArray(parsed) ? parsed : [context.channelIds];
        } catch (e) {
          console.warn('Failed to parse channelIds as JSON:', e);
          channelIds = [context.channelIds];
        }
      }
      // Otherwise treat as a single channel ID
      else if (typeof context.channelIds === 'string') {
        channelIds = [context.channelIds];
      }
    }

    // Fetch messages based on platform
    let query = supabase
      .from('memories')
      .select('*')
      .eq('type', 'messages')
      .gte('createdAt', startDate.toISOString())
      .lte('createdAt', endDate.toISOString());

    if (context.platform === 'discord') {
      query = query.contains('content', { source: 'discord' });
      
      if (channelIds && channelIds.length > 0) {
        // Create an array of channel URL patterns to match
        const channelPatterns = channelIds.map(channelId => 
          `/channels/${context.serverId}/${channelId}/`
        );
        
        // Build OR conditions for each channel pattern
        const channelFilters = channelPatterns.map(pattern => 
          `content->>url.like.%${pattern}%`
        ).join(',');
        
        query = query.or(channelFilters);
      } else {
        // If no specific channels, get all messages from the server
        query = query.filter('content->>url', 'like', `%/channels/${context.serverId}/%`);
      }
    } else {
      // Telegram platform
      query = query.contains('content', { source: 'telegram' });
      
      if (channelIds && channelIds.length > 0) {
        // For Telegram, we need to filter by thread_id
        // First, ensure we're looking at the right server
        query = query.filter('content->>server_id', 'eq', context.serverId);
        
        // Then build a filter for each thread ID
        let threadFilters = [];
        for (const threadId of channelIds) {
          // Add a filter for this specific thread ID
          threadFilters.push(`content->>thread_id.eq.${threadId}`);
        }
        
        // Combine the thread filters with OR
        if (threadFilters.length > 0) {
          const threadFilterString = threadFilters.join(',');
          query = query.or(threadFilterString);
        }
      } else {
        // If no specific channels, get all messages from the server
        query = query.filter('content->>server_id', 'eq', context.serverId);
      }
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
            datetime = memory.createdAt;
          } catch (error) {
            console.warn('Invalid date:', memory.createdAt);
            datetime = 'Unknown Date';
          }
          const platform = context.platform;
          
          // Enhanced channel information
          let channelInfo;
          if (context.platform === 'discord') {
            const urlParts = memory.content.url.split('/');
            const channelId = urlParts[5];
            channelInfo = `#${channelId}`;
          } else {
            channelInfo = memory.content.thread_id ? `Thread ${memory.content.thread_id}` : 'Main Channel';
          }
          
          return `[${datetime}] ${platform}/${channelInfo} ${username}: ${memory.content.text} (messageId: ${memory.id})`;
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