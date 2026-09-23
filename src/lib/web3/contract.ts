import { publicEnv } from "@/config/env";
import { arcMainnet } from "@/config/arc-mainnet";
import { omsetProAbi } from "@/lib/web3/omsetpro-abi";

export const omsetProContract = {
  address: publicEnv.NEXT_PUBLIC_OMSETPRO_CONTRACT_ADDRESS,
  abi: omsetProAbi,
  explorerUrl: `${arcMainnet.blockExplorers.default.url}/address/${publicEnv.NEXT_PUBLIC_OMSETPRO_CONTRACT_ADDRESS}`,
} as const;

export function getAddressExplorerUrl(address: string): string {
  return `${arcMainnet.blockExplorers.default.url}/address/${address}`;
}

export function getTransactionExplorerUrl(hash: string): string {
  return `${arcMainnet.blockExplorers.default.url}/tx/${hash}`;
}
