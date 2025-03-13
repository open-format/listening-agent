import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createClient } from '@supabase/supabase-js';
import { openai } from '@ai-sdk/openai';
import { embedMany } from "ai";
import { MDocument } from '@mastra/rag';

const supabase = createClient(
  process.env.BRITTNEY_SUPABASE_URL!,
  process.env.BRITTNEY_SUPABASE_KEY!
);

export const saveSummaryTool = createTool({
  id: 'save-summary',
  description: 'Save a community summary to the database with vector embeddings',
  inputSchema: z.object({
    communityId: z.string().uuid(),
    summary: z.string(),
    startDate: z.string(),
    endDate: z.string(),
    platform: z.enum(['discord', 'telegram']),
    messageCount: z.number(),
    uniqueUserCount: z.number(),
    activePeriodsCount: z.number(),
    summarizationResult: z.any(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    summaryId: z.string().uuid().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    try {
      // Extract the score from the summarization result
      const summarizationScore = context.summarizationResult?.score || null;
      
      // Generate embedding for the summary
      // Initialise the document
      const doc = MDocument.fromText(context.summary);

      // Create chunks
      const chunks = await doc.chunk({
        strategy: "recursive",
        size: 256,
        overlap: 50,
      });

      // Generate embeddings with OpenAI
      const { embeddings: openAIEmbeddings } = await embedMany({
        model: openai.embedding('text-embedding-3-small'),
        values: chunks.map((chunk: { text: string }) => chunk.text),
      });

      // Format embeddings for Supabase vector type
      const formattedEmbeddings = openAIEmbeddings[0]; // Take first embedding since we want to store one vector per summary

      // Insert the summary into the database
      const { data, error } = await supabase
        .from('community_summaries')
        .insert({
          community_id: context.communityId,
          summary: context.summary,
          start_date: new Date(context.startDate),
          end_date: new Date(context.endDate),
          platform: context.platform,
          message_count: context.messageCount,
          unique_user_count: context.uniqueUserCount,
          active_periods_count: context.activePeriodsCount,
          summarization_score: summarizationScore,
          summarization_details: context.summarizationResult || null,
          embedding: formattedEmbeddings,
        })
        .select('id')
        .single();

      if (error) {
        console.error('Error saving summary:', error);
        return {
          success: false,
          error: error.message,
        };
      }


      return {
        success: true,
        summaryId: data.id,
      };
    } catch (error: any) {
      console.error('Exception saving summary:', error);
      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  },
}); 