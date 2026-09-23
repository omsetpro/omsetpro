"use client";

import { useQuery } from "@tanstack/react-query";
import type { EVMChainDefinition } from "@circle-fin/bridge-kit";
import {
  createPublicClient,
  formatUnits,
  getAddress,
  http,
  type Address,
} from "viem";
import type { UsdcBalance } from "./bridge-types";
import { usdcBalanceAbi } from "./bridge-utils";

async function readUsdcBalance(
  chain: EVMChainDefinition,
  walletAddress: Address,
): Promise<UsdcBalance> {
  if (!chain.usdcAddress || !chain.rpcEndpoints[0]) {
    throw new Error(`Circle metadata for ${chain.name} is incomplete.`);
  }

  const client = createPublicClient({ transport: http(chain.rpcEndpoints[0]) });
  const tokenAddress = getAddress(chain.usdcAddress);
  const [value, decimals] = await Promise.all([
    client.readContract({
      address: tokenAddress,
      abi: usdcBalanceAbi,
      functionName: "balanceOf",
      args: [walletAddress],
    }),
    client.readContract({
      address: tokenAddress,
      abi: usdcBalanceAbi,
      functionName: "decimals",
    }),
  ]);

  return {
    value,
    decimals,
    formatted: formatUnits(value, decimals),
  };
}

export function useUsdcBalance(
  chain: EVMChainDefinition | undefined,
  walletAddress: Address | undefined,
) {
  return useQuery({
    queryKey: ["circle-usdc-balance", chain?.chainId, walletAddress],
    queryFn: () => readUsdcBalance(chain!, walletAddress!),
    enabled: Boolean(chain && walletAddress),
    staleTime: 15_000,
    refetchInterval: 30_000,
  });
}
