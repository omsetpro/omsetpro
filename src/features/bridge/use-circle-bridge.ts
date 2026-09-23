"use client";

import { createViemAdapterFromProvider } from "@circle-fin/adapter-viem-v2";
import type { ActionHandler } from "@circle-fin/bridge-kit";
import type { EIP1193Provider } from "viem";
import { useCallback, useRef, useState } from "react";
import { useSwitchChain } from "wagmi";
import {
  circleBridgeKit,
  circleEvmMainnetChains,
  supportsCircleUsdcRoute,
} from "./circle-bridge";
import type {
  BridgeEvidenceStep,
  BridgeExecutionState,
  BridgeTransferDraft,
} from "./bridge-types";
import {
  bridgeErrorMessage,
  evidenceFromResult,
  hasAuthoritativeSuccessfulBurn,
  isRecoverableBridgeResult,
} from "./bridge-utils";
import { useCanonicalWallet } from "@/features/wallet/use-canonical-wallet";

const initialState: BridgeExecutionState = {
  phase: "idle",
  steps: [],
};

function isEip1193Provider(value: unknown): value is EIP1193Provider {
  return Boolean(
    value &&
      typeof value === "object" &&
      "request" in value &&
      typeof value.request === "function",
  );
}

function upsertStep(
  steps: BridgeEvidenceStep[],
  step: BridgeEvidenceStep,
): BridgeEvidenceStep[] {
  const index = steps.findIndex((candidate) => candidate.id === step.id);
  if (index === -1) return [...steps, step];
  return steps.map((candidate, candidateIndex) =>
    candidateIndex === index ? { ...candidate, ...step } : candidate,
  );
}

type CircleBridgeEvent = Parameters<
  ActionHandler<typeof circleBridgeKit>
>[0];

export function useCircleBridge() {
  const wallet = useCanonicalWallet();
  const { switchChainAsync } = useSwitchChain();
  const [state, setState] = useState<BridgeExecutionState>(initialState);
  const activeRef = useRef(false);

  const recordEvent = useCallback(
    (event: CircleBridgeEvent, draft: BridgeTransferDraft) => {
      const method = event.method;
      const sdkStep = event.values;
      if (!("name" in sdkStep) || !("state" in sdkStep)) return;
      const normalized = method.toLowerCase();
      const chain = normalized.includes("mint")
        ? draft.destination
        : draft.source;
      const step: BridgeEvidenceStep = {
        id: method,
        label: normalized.includes("approve")
          ? "USDC approval"
          : normalized.includes("burn")
            ? "Source burn"
            : normalized.includes("attestation")
              ? "Circle attestation"
              : normalized.includes("mint")
                ? "Destination mint"
                : sdkStep.name,
        state: sdkStep.state,
        chainName: sdkStep.txHash ? chain.title ?? chain.name : undefined,
        transactionHash: sdkStep.txHash,
        explorerUrl: sdkStep.explorerUrl,
        detail:
          sdkStep.state === "error"
            ? "Circle Bridge Kit reported that this step did not complete."
            : undefined,
      };

      setState((current) => {
        const steps = upsertStep(current.steps, step);
        let phase = current.phase;
        if (sdkStep.state === "error") {
          phase = "failed";
        } else if (normalized.includes("approve")) {
          phase =
            sdkStep.state === "success" || sdkStep.state === "noop"
              ? "approval-submitted"
              : "awaiting-approval";
        } else if (normalized.includes("burn")) {
          phase =
            sdkStep.state === "success"
              ? "waiting-attestation"
              : "burn-submitted";
        } else if (normalized.includes("attestation")) {
          phase =
            sdkStep.state === "success"
              ? "destination-finalization"
              : "waiting-attestation";
        } else if (normalized.includes("mint")) {
          phase = "destination-finalization";
        }

        return { ...current, phase, steps };
      });
    },
    [],
  );

  const subscribeToStepEvents = useCallback(
    (draft: BridgeTransferDraft) => {
      const onEvent: ActionHandler<typeof circleBridgeKit> = (event) =>
        recordEvent(event, draft);
      circleBridgeKit.on("*", onEvent);

      return () => {
        circleBridgeKit.off("*", onEvent);
      };
    },
    [recordEvent],
  );

  const createAdapter = useCallback(async () => {
    const connector = wallet.connection.connector;
    if (!connector) throw new Error("No active EVM wallet connector.");

    const provider = await connector.getProvider();
    if (!isEip1193Provider(provider)) {
      throw new Error("The active wallet did not expose an EIP-1193 provider.");
    }

    return createViemAdapterFromProvider({
      provider,
      capabilities: {
        addressContext: "user-controlled",
        supportedChains: circleEvmMainnetChains,
      },
    });
  }, [wallet.connection.connector]);

  const estimate = useCallback(
    async (draft: BridgeTransferDraft) => {
      if (!(await supportsCircleUsdcRoute(draft.source, draft.destination))) {
        throw new Error("Circle Bridge Kit does not support this USDC route.");
      }
      const adapter = await createAdapter();
      return circleBridgeKit.estimate({
        from: { adapter, chain: draft.source },
        to: {
          adapter,
          chain: draft.destination,
          recipientAddress: draft.recipient,
        },
        amount: draft.amount,
        config: { transferSpeed: draft.transferSpeed },
      });
    },
    [createAdapter],
  );

  const bridge = useCallback(
    async (draft: BridgeTransferDraft) => {
      if (activeRef.current) return;
      activeRef.current = true;
      setState({ phase: "preparing", steps: [], draft });

      const unsubscribe = subscribeToStepEvents(draft);

      try {
        if (wallet.chainId !== draft.source.chainId) {
          setState((current) => ({ ...current, phase: "awaiting-network" }));
          await switchChainAsync({ chainId: draft.source.chainId });
        }

        if (!(await supportsCircleUsdcRoute(draft.source, draft.destination))) {
          throw new Error("Circle Bridge Kit does not support this USDC route.");
        }
        const adapter = await createAdapter();
        await circleBridgeKit.estimate({
          from: { adapter, chain: draft.source },
          to: {
            adapter,
            chain: draft.destination,
            recipientAddress: draft.recipient,
          },
          amount: draft.amount,
          config: { transferSpeed: draft.transferSpeed },
        });
        if (!(await supportsCircleUsdcRoute(draft.source, draft.destination))) {
          throw new Error("Circle Bridge Kit no longer reports this USDC route as supported.");
        }
        setState((current) => ({ ...current, phase: "awaiting-approval" }));
        const result = await circleBridgeKit.bridge({
          from: { adapter, chain: draft.source },
          to: {
            adapter,
            chain: draft.destination,
            recipientAddress: draft.recipient,
          },
          amount: draft.amount,
          config: { transferSpeed: draft.transferSpeed },
        });
        const resultSteps = evidenceFromResult(
          result,
          draft.source,
          draft.destination,
        );
        const burnSubmitted = hasAuthoritativeSuccessfulBurn(result);

        setState({
          phase:
            result.state === "success"
              ? "completed"
              : burnSubmitted
                ? "pending-finalization"
                : "failed",
          message:
            result.state === "success"
              ? undefined
              : bridgeErrorMessage(
                  result.steps.find((step) => step.state === "error")?.error,
                  burnSubmitted,
                ),
          draft,
          steps: resultSteps,
          result,
        });
      } catch (error) {
        if (process.env.NODE_ENV === "development") {
          console.error("Circle Bridge Kit transfer failed", error);
        }
        setState((current) => ({
          ...current,
          phase: "failed",
          message: bridgeErrorMessage(error, false),
          draft,
          steps: current.steps,
        }));
      } finally {
        unsubscribe();
        activeRef.current = false;
      }
    },
    [createAdapter, subscribeToStepEvents, switchChainAsync, wallet.chainId],
  );

  const resume = useCallback(async () => {
    const result = state.result;
    const draft = state.draft;
    if (
      activeRef.current ||
      !result ||
      !draft ||
      !isRecoverableBridgeResult(result)
    ) {
      return;
    }

    activeRef.current = true;
    const unsubscribe = subscribeToStepEvents(draft);
    setState((current) => ({
      ...current,
      phase: "destination-finalization",
      message:
        "Resuming from the completed source burn. Do not submit a new transfer for the same funds.",
    }));

    try {
      const adapter = await createAdapter();
      const retryResult = await circleBridgeKit.retry(result, {
        from: adapter,
        to: adapter,
      });
      const retrySteps = evidenceFromResult(
        retryResult,
        draft.source,
        draft.destination,
      );
      const burnSucceeded = hasAuthoritativeSuccessfulBurn(retryResult);

      setState({
        phase:
          retryResult.state === "success"
            ? "completed"
            : burnSucceeded
              ? "pending-finalization"
              : "failed",
        message:
          retryResult.state === "success"
            ? undefined
            : bridgeErrorMessage(
                retryResult.steps.find((step) => step.state === "error")?.error,
                burnSucceeded,
              ),
        draft,
        steps: retrySteps,
        result: retryResult,
      });
    } catch (error) {
      if (process.env.NODE_ENV === "development") {
        console.error("Circle Bridge Kit recovery failed", error);
      }
      setState((current) => ({
        ...current,
        phase: "pending-finalization",
        message:
          "The source burn remains complete, but Circle finalization did not finish in this attempt. Do not start the same transfer again; retry finalization when the network is ready.",
        result,
      }));
    } finally {
      unsubscribe();
      activeRef.current = false;
    }
  }, [createAdapter, state.draft, state.result, subscribeToStepEvents]);

  const reset = useCallback(() => {
    if (!activeRef.current) setState(initialState);
  }, []);

  return {
    state,
    bridge,
    resume,
    estimate,
    reset,
    canResume: isRecoverableBridgeResult(state.result),
  };
}
