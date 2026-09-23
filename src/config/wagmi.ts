import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { arcMainnet } from "@/config/arc-mainnet";

export const wagmiConfig = createConfig({
  chains: [arcMainnet],
  transports: {
    [arcMainnet.id]: http(
      arcMainnet.rpcUrls.default.http[0],
    ),
  },
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
