import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { ThirdwebStorage } from "@thirdweb-dev/storage";
import 'dotenv/config';

const THIRDWEB_SECRET = process.env.THIRDWEB_SECRET;
if (!THIRDWEB_SECRET) {
  throw new Error("THIRDWEB_SECRET environment variable is not set");
}

const storage = new ThirdwebStorage({
  secretKey: THIRDWEB_SECRET,
});

interface Badge {
  id: string;
  name: string;
  description: string;
  totalAwarded: string;
}

interface GraphQLResponse {
  data: {
    apps?: Array<{
      badges: Badge[];
      tokens: Array<{
        token: {
          id: string;
          name: string;
        }
      }>;
    }>;
  };
}

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/82634/open-format-arbitrum-sepolia/v0.1.1";

async function getMetadata(ipfsHash: string) {
  const metadata = await storage.downloadJSON(ipfsHash);

  if (metadata.image) {
    const image = await storage.download(metadata.image);
    metadata.image = image.url;
  }

  return metadata;
}

export const getTokensAndBadgesTool = createTool({
  id: 'get-tokens-and-badges',
  description: 'Get available tokens and badges for a community',
  inputSchema: z.object({
    communityAddress: z.string(),
  }),
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
    error: z.string().optional(),
  }),
  execute: async ({ context }) => {
    try {
      const query = `
        query CreateBadgeList($communityAddress: ID!) {
          apps(where: {id: $communityAddress}){
            badges{
              id
              name
              metadataURI
              totalAwarded
            }
            tokens{
              token{
                id
                name
              }
            }
          }
        }
      `;

      const response = await fetch(SUBGRAPH_URL, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Accept': 'application/json'
        },
        body: JSON.stringify({
          query,
          variables: { communityAddress: context.communityAddress.toLowerCase() }
        })
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json() as GraphQLResponse;
      const app = data.data?.apps?.[0];
      
      if (!app) {
        return {
          success: true,
          badges: [],
          tokens: []
        };
      }

      const badgesWithMetadata = await Promise.all(
        app.badges.map(async (badge: any) => {
          try {
            const metadata = await getMetadata(badge.metadataURI);
            return {
              id: badge.id,
              name: metadata.name,
              description: metadata.description,
              totalAwarded: badge.totalAwarded
            };
          } catch (error) {
            console.error(`Error fetching metadata for badge ${badge.id}:`, error);
            return {
              id: badge.id,
              name: badge.name,
              description: '',
              totalAwarded: badge.totalAwarded
            };
          }
        })
      );

      return {
        success: true,
        badges: badgesWithMetadata,
        tokens: app.tokens.map((t: any) => ({
          id: t.token.id,
          name: t.token.name
        }))
      };

    } catch (error: any) {
      console.error('Error fetching tokens and badges:', error);
      return {
        success: false,
        error: error.message || 'Unknown error'
      };
    }
  },
}); 