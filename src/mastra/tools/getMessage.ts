import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.STEVE_SUPABASE_URL!,
  process.env.STEVE_SUPABASE_KEY!
);

export const fetchMessageByIdTool = createTool({
  id: 'fetch-message-by-id',
  description: 'Fetch a specific message by its ID from the database',
  inputSchema: z.object({
    messageId: z.string().uuid(),
  }),
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
  execute: async (context) => {
    try {
      // Fetch the message by ID
      const { data: messageData, error: messageError } = await supabase
        .from('memories')
        .select('*')
        .eq('type', 'messages')
        .eq('id', context.context.messageId)
        .single();

      if (messageError) {
        console.error('Error fetching message:', messageError);
        return {
          id: context.context.messageId,
          content: {
            text: '',
            source: 'discord' as const,
            url: undefined,
            server_id: undefined,
            thread_id: undefined,
            channel_id: undefined
          },
          createdAt: '',
          userId: '',
          username: null,
          error: `Failed to fetch message: ${messageError.message}`
        };
      }

      if (!messageData) {
        return {
          id: context.context.messageId,
          content: {
            text: '',
            source: 'discord' as const,
            url: undefined,
            server_id: undefined,
            thread_id: undefined,
            channel_id: undefined
          },
          createdAt: '',
          userId: '',
          username: null,
          error: 'Message not found'
        };
      }

      // Extract channel ID and server ID for Discord messages
      let channelId = null;
      let serverId = null;
      if (messageData.content.source === 'discord' && messageData.content.url) {
        const urlParts = messageData.content.url.split('/');
        if (urlParts.length >= 6) {
          serverId = urlParts[4];  // Extract serverId (guild ID)
          channelId = urlParts[5]; // Extract channelId
        }
      }

      // For Telegram, the server_id is already in the content
      if (messageData.content.source === 'telegram') {
        serverId = messageData.content.server_id;
      }

      // Update content to include parsed channel_id and server_id
      const enhancedContent = {
        ...messageData.content,
        channel_id: channelId,
        server_id: serverId
      };

      // Fetch user details
      const { data: userData, error: userError } = await supabase
        .from('accounts')
        .select('username')
        .eq('id', messageData.userId)
        .single();

      if (userError) {
        console.warn('Error fetching user details:', userError);
      }

      return {
        id: messageData.id,
        content: enhancedContent,
        createdAt: messageData.createdAt,
        userId: messageData.userId,
        username: userData?.username || null
      };
    } catch (error: any) {
      console.error('Error processing message:', error);
      return {
        id: context.context.messageId,
        content: {
          text: '',
          source: 'discord' as const,
          url: undefined,
          server_id: undefined,
          thread_id: undefined,
          channel_id: undefined
        },
        createdAt: '',
        userId: '',
        username: null,
        error: `Failed to process message: ${error.message}`
      };
    }
  },
}); 