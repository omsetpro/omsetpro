import type {
  BridgeResult,
  EstimateResult,
  EVMChainDefinition,
  TransferSpeed,
} from "@circle-fin/bridge-kit";

export type BridgePhase =
  | "idle"
  | "preparing"
  | "awaiting-network"
  | "awaiting-approval"
  | "approval-submitted"
  | "burn-submitted"
  | "waiting-attestation"
  | "destination-finalization"
  | "pending-finalization"
  | "completed"
  | "failed";

export type BridgeEvidenceStep = {
  id: string;
  label: string;
  state: "pending" | "success" | "error" | "noop";
  chainName?: string;
  transactionHash?: string;
  explorerUrl?: string;
  detail?: string;
};

export type BridgeTransferDraft = {
  source: EVMChainDefinition;
  destination: EVMChainDefinition;
  amount: string;
  recipient: `0x${string}`;
  transferSpeed: TransferSpeed;
};

export type BridgeExecutionState = {
  phase: BridgePhase;
  message?: string;
  draft?: BridgeTransferDraft;
  steps: BridgeEvidenceStep[];
  result?: BridgeResult;
};

export type BridgeEstimate = EstimateResult | undefined;

export type UsdcBalance = {
  value: bigint;
  decimals: number;
  formatted: string;
};
