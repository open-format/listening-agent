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

const SUBGRAPH_URL = "https://api.studio.thegraph.com/query/82634/open-format-arbitrum-sepolia/v0.1.1";

export const getRewardsTool = createTool({
    id: 'get-rewards',
    description: 'Get recent rewards (both badges and tokens) for a community',
    inputSchema: z.object({
      communityAddress: z.string(),
    }),
    outputSchema: z.object({
      success: z.boolean(),
      rewards: z.array(z.object({
        rewardId: z.string(),
        userId: z.string(),
        type: z.enum(['badge', 'token']),
        badgeName: z.string().optional(),
        tokenName: z.string().optional(),
        tokenAmount: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        image: z.string().optional(),
      })),
      error: z.string().optional(),
    }),
    execute: async ({ context }) => {
      try {
        const [badgeRewards, tokenRewards] = await Promise.all([
          getRecentBadgeRewards(context.communityAddress.toLowerCase()),
          getRecentTokenRewards(context.communityAddress.toLowerCase())
        ]);
  
        const allRewards = [...badgeRewards, ...tokenRewards]
          .sort((a, b) => a.rewardId.localeCompare(b.rewardId));
  
        return {
          success: true,
          rewards: allRewards
        };
      } catch (error: any) {
        console.error('Error fetching rewards:', error);
        return {
          success: false,
          rewards: [],
          error: error.message || 'Unknown error occurred'
        };
      }
    },
  }); 

async function getMetadata(ipfsHash: string) {
  const metadata = await storage.downloadJSON(ipfsHash);

  if (metadata.image) {
    const image = await storage.download(metadata.image);
    metadata.image = image.url;
  }

  return metadata;
}

async function getRecentBadgeRewards(communityId: string) {
  const query = `
    query getRecentBadgeRewards {
      rewards(
        orderBy: createdAt, 
        orderDirection: desc, 
        first: 10, 
        where: {
          app: "${communityId}",
          badge_not: null
        }
      ) {
        rewardId
        user {
          id
        }
        metadataURI
        badge {
          name
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
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const rewards = data.data?.rewards || [];
  
  return Promise.all(
    rewards.map(async (reward: any) => {
      try {
        const metadata = await getMetadata(reward.metadataURI);
        return {
          rewardId: reward.rewardId,
          userId: reward.user.id,
          badgeName: reward.badge.name,
          type: 'badge',
          ...metadata
        };
      } catch (error) {
        console.error(`Error fetching metadata for badge reward ${reward.rewardId}:`, error);
        return {
          rewardId: reward.rewardId,
          userId: reward.user.id,
          badgeName: reward.badge.name,
          type: 'badge'
        };
      }
    })
  );
}

async function getRecentTokenRewards(communityId: string) {
  const query = `
    query getRecentTokenRewards {
      rewards(
        orderBy: createdAt, 
        orderDirection: desc, 
        first: 10, 
        where: {
          app: "${communityId}",
          token_not: null
        }
      ) {
        rewardId
        user {
          id
        }
        metadataURI
        token {
          name
        }
        tokenAmount
      }
    }
  `;

  const response = await fetch(SUBGRAPH_URL, {
    method: 'POST',
    headers: { 
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    throw new Error(`HTTP error! status: ${response.status}`);
  }

  const data = await response.json();
  const rewards = data.data?.rewards || [];
  
  return Promise.all(
    rewards.map(async (reward: any) => {
      try {
        const metadata = await getMetadata(reward.metadataURI);
        return {
          rewardId: reward.rewardId,
          userId: reward.user.id,
          tokenName: reward.token.name,
          tokenAmount: (Number(reward.tokenAmount) / 1e18).toString(),
          type: 'token',
          ...metadata
        };
      } catch (error) {
        console.error(`Error fetching metadata for token reward ${reward.rewardId}:`, error);
        return {
          rewardId: reward.rewardId,
          userId: reward.user.id,
          tokenName: reward.token.name,
          tokenAmount: (Number(reward.tokenAmount) / 1e18).toString(),
          type: 'token'
        };
      }
    })
  );
}