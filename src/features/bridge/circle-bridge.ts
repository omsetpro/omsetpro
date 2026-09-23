import {
  BridgeKit,
  type ChainDefinition,
  type EVMChainDefinition,
} from "@circle-fin/bridge-kit";
import { defineChain, type Chain } from "viem";
import { arcMainnet } from "@/config/arc-mainnet";

export const circleBridgeKit = new BridgeKit();

export const circleEvmMainnetChains = circleBridgeKit
  .getSupportedChains({ chainType: "evm", isTestnet: false })
  .filter(
    (chain): chain is EVMChainDefinition =>
      chain.type === "evm" && Boolean(chain.usdcAddress && chain.cctp),
  );

if (circleEvmMainnetChains.length === 0) {
  throw new Error("Circle Bridge Kit did not report any EVM mainnet chains.");
}

function explorerBaseUrl(explorerUrl: string): string {
  return explorerUrl.replace(/\/tx\/\{hash\}\/?$/, "").replace(/\/$/, "");
}

function toViemChain(chain: EVMChainDefinition): Chain {
  if (chain.chainId === arcMainnet.id) return arcMainnet;

  const rpcUrl = chain.rpcEndpoints[0];
  if (!rpcUrl) {
    throw new Error(`Circle Bridge Kit did not provide an RPC for ${chain.name}.`);
  }

  return defineChain({
    id: chain.chainId,
    name: chain.title ?? chain.name,
    nativeCurrency: chain.nativeCurrency,
    rpcUrls: {
      default: { http: [...chain.rpcEndpoints] },
    },
    blockExplorers: {
      default: {
        name: `${chain.name} explorer`,
        url: explorerBaseUrl(chain.explorerUrl),
      },
    },
    testnet: false,
  });
}

export const circleViemMainnetChains = circleEvmMainnetChains.map(toViemChain);

const detectedArcCircleChain = circleEvmMainnetChains.find(
  (chain) => chain.chainId === arcMainnet.id,
);

if (!detectedArcCircleChain) {
  throw new Error("Arc Mainnet is unavailable in Circle Bridge Kit metadata.");
}

export const arcCircleChain = detectedArcCircleChain;

export function getCircleChain(chainId: number): EVMChainDefinition | undefined {
  return circleEvmMainnetChains.find((chain) => chain.chainId === chainId);
}

export async function supportsCircleUsdcRoute(
  source: EVMChainDefinition,
  destination: EVMChainDefinition,
): Promise<boolean> {
  if (source.chainId === destination.chainId) return false;

  const providers = circleBridgeKit.providers as readonly {
    supportsRoute(
      sourceChain: ChainDefinition,
      destinationChain: ChainDefinition,
      token: "USDC",
    ): boolean | Promise<boolean>;
  }[];
  let routeCheckError: unknown;
  for (const provider of providers) {
    try {
      if (await provider.supportsRoute(source, destination, "USDC")) {
        return true;
      }
    } catch (error) {
      routeCheckError = error;
    }
  }

  if (routeCheckError) throw routeCheckError;
  return false;
}
