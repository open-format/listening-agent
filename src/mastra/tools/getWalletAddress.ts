import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { PrivyClient } from "@privy-io/server-auth";

interface SocialAccount {
  username: string;
  platform: "telegram" | "discord";
}

interface WalletInfo {
  username: string;
  platform: "telegram" | "discord";
  walletAddress: string | null;
  error?: string;
}

const privyClient = new PrivyClient(
  process.env.PRIVY_APP_ID!,
  process.env.PRIVY_APP_SECRET!
);

export const getWalletAddressTool = createTool({
    id: 'get-wallet-address',
    description: 'Get wallet address for a Discord or Telegram user using Privy',
    inputSchema: z.object({
      username: z.string(),
      platform: z.enum(['discord', 'telegram']),
    }),
    outputSchema: z.object({
      username: z.string(),
      platform: z.enum(['discord', 'telegram']),
      walletAddress: z.string().nullable(),
      error: z.string().optional()
    }),
    execute: async ({ context }) => {
      return getSocialAccountWallet({
        username: context.username,
        platform: context.platform
      });

async function getSocialAccountWallet(account: SocialAccount): Promise<WalletInfo> {
  try {
    if (!account.username) {
      return {
        username: account.username,
        platform: account.platform,
        walletAddress: null,
        error: "No username found for this user."
      };
    }

    let user;
    if (account.platform === "telegram") {
      user = await privyClient.getUserByTelegramUsername(account.username);
    } else {
      user = await privyClient.getUserByDiscordUsername(account.username);
    }

    if (!user) {
      return {
        username: account.username,
        platform: account.platform,
        walletAddress: null,
        error: `No Privy account found for ${account.platform} user ${account.username}. Create one at https://rewards.openformat.tech/open-format`
      };
    }

    const walletAccount = user.linkedAccounts.find(acc => acc.type === "wallet");

    if (!walletAccount?.address) {
      return {
        username: account.username,
        platform: account.platform,
        walletAddress: null,
        error: `User ${account.username} has not connected a wallet to their Privy account. Connect one at https://rewards.openformat.tech/open-format`
      };
    }

    return {
      username: account.username,
      platform: account.platform,
      walletAddress: walletAccount.address
    };
  } catch (error) {
    return {
      username: account.username,
      platform: account.platform,
      walletAddress: null,
      error: `Error getting wallet info: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}
  },
}); 