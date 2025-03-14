import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { createPublicClient, createWalletClient, http, type Address, stringToHex, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { rewardFacetAbi } from "../abis/RewardFacet.js";

if (!process.env.PRIVATE_KEY) {
  throw new Error("PRIVATE_KEY is not set");
}

const publicClient = createPublicClient({
  chain: arbitrumSepolia,
  transport: http(),
});

const walletClient = createWalletClient({
  chain: arbitrumSepolia,
  account: privateKeyToAccount(process.env.PRIVATE_KEY as Address),
  transport: http(),
});

interface RewardPointsParams {
  user: Address;
  amount: bigint;
  rewardId: string;
  pointsTokenAddress: Address;
  communityAddress: Address;
  ipfsHash: string;
}

async function rewardPoints(data: RewardPointsParams) {
  const tx = await walletClient.writeContract({
    address: data.communityAddress,
    abi: rewardFacetAbi,
    functionName: "mintERC20",
    args: [
      data.pointsTokenAddress,
      data.user,
      data.amount,
      stringToHex(data.rewardId, { size: 32 }),
      stringToHex("MISSION", { size: 32 }),
      data.ipfsHash,
    ],
  });

  const receipt = await publicClient.waitForTransactionReceipt({ hash: tx });
  return receipt.transactionHash;
}

export const rewardTokenTool = createTool({
  id: 'reward-token',
  description: 'Reward tokens to a user using direct contract interaction',
  inputSchema: z.object({
    receiver: z.string(),
    rewardId: z.string(),
    points: z.number(),
    pointsTokenAddress: z.string(),
    communityAddress: z.string(),
    ipfsHash: z.string().default("ipfs://")
  }),
  outputSchema: z.object({
    success: z.boolean(),
    transactionHash: z.string().optional(),
    error: z.string().optional()
  }),
  execute: async ({ context }) => {
    try {
      const transactionHash = await rewardPoints({
        user: context.receiver as Address,
        amount: parseEther(context.points.toString()),
        rewardId: context.rewardId,
        pointsTokenAddress: context.pointsTokenAddress as Address,
        communityAddress: context.communityAddress as Address,
        ipfsHash: context.ipfsHash
      });

      return {
        success: true,
        transactionHash
      };
    } catch (error: any) {
      console.error('Error rewarding token:', error);
      return {
        success: false,
        error: error.message || 'Unknown error occurred while rewarding token'
      };
    }
  },
}); 