"use client";

import { useQuery } from "@tanstack/react-query";
import type { EVMChainDefinition } from "@circle-fin/bridge-kit";
import {
  circleEvmMainnetChains,
  supportsCircleUsdcRoute,
} from "./circle-bridge";

export function useBridgeSupportedDestinations(
  source: EVMChainDefinition | undefined,
) {
  return useQuery({
    queryKey: ["circle-usdc-routes", source?.chainId],
    queryFn: async () => {
      if (!source) return [];

      const candidates = circleEvmMainnetChains.filter(
        (chain) => chain.chainId !== source.chainId,
      );
      const support = await Promise.all(
        candidates.map(async (destination) => ({
          destination,
          supported: await supportsCircleUsdcRoute(source, destination),
        })),
      );

      return support
        .filter((route) => route.supported)
        .map((route) => route.destination);
    },
    enabled: Boolean(source),
    staleTime: Infinity,
    retry: 1,
  });
}
