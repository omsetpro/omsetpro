import {
  getErrorMessage,
  isBalanceError,
  isInputError,
  isNetworkError,
  isOnchainError,
  isRpcError,
  isServiceError,
  type BridgeResult,
  type EVMChainDefinition,
  type EstimateResult,
} from "@circle-fin/bridge-kit";
import { erc20Abi, isAddress, parseUnits } from "viem";
import type {
  BridgeEvidenceStep,
  BridgePhase,
  BridgeTransferDraft,
  UsdcBalance,
} from "./bridge-types";

export function parseUsdcAmount(
  amount: string,
  decimals: number,
): bigint | undefined {
  if (!/^\d+(?:\.\d+)?$/.test(amount.trim())) return undefined;

  try {
    const value = parseUnits(amount, decimals);
    return value > BigInt(0) ? value : undefined;
  } catch {
    return undefined;
  }
}

export function validateBridgeDraft({
  address,
  amount,
  balance,
  source,
  destination,
  recipient,
}: {
  address?: string;
  amount: string;
  balance?: UsdcBalance;
  source?: EVMChainDefinition;
  destination?: EVMChainDefinition;
  recipient: string;
}): string | undefined {
  if (!address) return "Connect an EVM wallet to bridge USDC.";
  if (!source || !destination) return "Choose a supported source and destination.";
  if (source.chainId === destination.chainId) {
    return "Source and destination networks must be different.";
  }
  if (!isAddress(recipient)) return "The destination wallet address is invalid.";
  if (!balance) return "Wait for the source USDC balance to load.";

  const parsedAmount = parseUsdcAmount(amount, balance.decimals);
  if (!parsedAmount) return "Enter a valid USDC amount greater than zero.";
  if (parsedAmount > balance.value) {
    return "The amount exceeds the available source USDC balance.";
  }

  return undefined;
}

export function phaseLabel(phase: BridgePhase): string {
  switch (phase) {
    case "preparing":
      return "Preparing transfer";
    case "awaiting-network":
      return "Awaiting source network";
    case "awaiting-approval":
      return "Awaiting USDC approval";
    case "approval-submitted":
      return "Approval submitted";
    case "burn-submitted":
      return "Source burn submitted";
    case "waiting-attestation":
      return "Waiting for Circle finality";
    case "destination-finalization":
      return "Finalizing on destination";
    case "pending-finalization":
      return "Source complete · finalization pending";
    case "completed":
      return "Bridge completed";
    case "failed":
      return "Bridge stopped";
    default:
      return "Ready to bridge";
  }
}

function friendlyActionName(name: string): string {
  const normalized = name.toLowerCase();
  if (normalized.includes("approve")) return "USDC approval";
  if (normalized.includes("burn")) return "Source burn";
  if (normalized.includes("attestation")) return "Circle attestation";
  if (normalized.includes("mint")) return "Destination mint";
  return name.replaceAll(/[_-]/g, " ");
}

export function evidenceFromResult(
  result: BridgeResult,
  source: EVMChainDefinition,
  destination: EVMChainDefinition,
): BridgeEvidenceStep[] {
  return result.steps.map((step, index) => {
    const normalizedName = step.name.toLowerCase();
    const chain = normalizedName.includes("mint") ? destination : source;

    return {
      id: `${step.name}-${index}`,
      label: friendlyActionName(step.name),
      state: step.state,
      chainName: step.txHash ? chain.title ?? chain.name : undefined,
      transactionHash: step.txHash,
      explorerUrl: step.explorerUrl,
      detail:
        step.state === "error"
          ? "This bridge step did not complete. No later step was assumed successful."
          : undefined,
    };
  });
}

export function bridgeErrorMessage(error: unknown, burnSubmitted: boolean): string {
  if (burnSubmitted) {
    return "The source burn succeeded, but destination finalization has not completed yet. Your transfer is not lost; keep the transaction evidence below and try again later if Circle finality is delayed.";
  }

  const message = getErrorMessage(error).toLowerCase();
  if (message.includes("user rejected") || message.includes("user denied")) {
    return "The wallet request was rejected before the transfer was submitted.";
  }
  if (isBalanceError(error) || message.includes("insufficient funds")) {
    return "The source wallet does not have enough USDC or native gas for this transfer.";
  }
  if (isInputError(error) || message.includes("unsupported route")) {
    return "Circle Bridge Kit does not support this route or transfer configuration.";
  }
  if (isRpcError(error) || isNetworkError(error) || isServiceError(error)) {
    return "A network or Circle service request failed before completion. Check the recorded transaction steps before trying again.";
  }
  if (isOnchainError(error)) {
    return "A source-chain transaction failed onchain. No completed burn was detected.";
  }

  return "Circle Bridge Kit could not complete this transfer. Review the progress details and try again.";
}

export function summarizeEstimate(
  estimate: EstimateResult | undefined,
  chains: EVMChainDefinition[],
): string[] {
  if (!estimate) return [];

  const fees = estimate.fees
    .filter((fee) => fee.amount && !fee.error)
    .map((fee) => `${fee.amount} ${fee.token} ${fee.type} fee`);
  const gas = estimate.gasFees
    .filter((fee) => fee.fees && !fee.error)
    .map((fee) => {
      const total = fee.fees?.fee;
      const chain = chains.find((candidate) => candidate.chain === fee.blockchain);
      if (!total || !chain) return undefined;
      return `${total} ${fee.token} gas on ${chain.name}`;
    })
    .filter((value): value is string => Boolean(value));

  return [...fees, ...gas];
}

export function hasAuthoritativeSuccessfulBurn(result: BridgeResult): boolean {
  return result.steps.some(
    (step) => step.name === "burn" && step.state === "success",
  );
}

export function isRecoverableBridgeResult(result?: BridgeResult): boolean {
  if (!result || result.state === "success") return false;
  const burnSucceeded = hasAuthoritativeSuccessfulBurn(result);
  const mintSucceeded = result.steps.some(
    (step) => step.name === "mint" && step.state === "success",
  );
  return burnSucceeded && !mintSucceeded;
}

export function completedTransferSummary(draft: BridgeTransferDraft): string {
  return `${draft.amount} USDC · ${draft.source.title ?? draft.source.name} to ${draft.destination.title ?? draft.destination.name}`;
}

export const usdcBalanceAbi = [
  erc20Abi.find((item) => item.type === "function" && item.name === "balanceOf")!,
  erc20Abi.find((item) => item.type === "function" && item.name === "decimals")!,
] as const;
