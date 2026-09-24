"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { Toaster } from "sonner";
import { publicEnv } from "@/config/env";
import { arcMainnet } from "@/config/arc-mainnet";
import { wagmiConfig } from "@/config/wagmi";
import { circleViemMainnetChains } from "@/features/bridge/circle-bridge";

export function AppProviders({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );

  return (
    <PrivyProvider
      appId={publicEnv.NEXT_PUBLIC_PRIVY_APP_ID}
      config={{
        loginMethods: ["google", "twitter", "wallet"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        supportedChains: circleViemMainnetChains,
        defaultChain: arcMainnet,
        appearance: {
          theme: "#0a0701",
          accentColor: "#2f6758",
          landingHeader: "Welcome to OmsetPro",
          loginMessage: "Sign in to manage item lending agreements and security deposits.",
          showWalletLoginFirst: false,
          walletChainType: "ethereum-only",
          walletList: [
            "rabby_wallet",
            "detected_ethereum_wallets",
            "wallet_connect",
          ],
        },
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={wagmiConfig}>
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              className: "omsetpro-toast",
            }}
          />
        </WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
