import { defineChain } from "viem";
import { publicEnv } from "@/config/env";

export const arcMainnet = defineChain({
  id: 5_042,
  name: "Arc Mainnet",
  nativeCurrency: {
    name: "USD Coin",
    symbol: "USDC",
    decimals: 18,
  },
  rpcUrls: {
    default: {
      http: [publicEnv.NEXT_PUBLIC_ARC_RPC_URL],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://explorer.arc.io",
    },
  },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
  testnet: false,
});
