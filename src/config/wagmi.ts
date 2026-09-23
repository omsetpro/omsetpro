import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { circleViemMainnetChains } from "@/features/bridge/circle-bridge";

const supportedChains = circleViemMainnetChains as [
  (typeof circleViemMainnetChains)[number],
  ...(typeof circleViemMainnetChains)[number][],
];

export const wagmiConfig = createConfig({
  chains: supportedChains,
  transports: Object.fromEntries(
    supportedChains.map((chain) => [
      chain.id,
      http(chain.rpcUrls.default.http[0]),
    ]),
  ),
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
