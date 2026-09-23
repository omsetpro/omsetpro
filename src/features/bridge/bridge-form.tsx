"use client";

import { TransferSpeed } from "@circle-fin/bridge-kit";
import { usePrivy } from "@privy-io/react-auth";
import { ArrowDownUp, CircleAlert, Info, WalletCards } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { getAddress } from "viem";
import { useCanonicalWallet } from "@/features/wallet/use-canonical-wallet";
import { BridgeChainSelector } from "./bridge-chain-selector";
import {
  arcCircleChain,
  circleEvmMainnetChains,
  getCircleChain,
} from "./circle-bridge";
import type {
  BridgeEstimate,
  BridgeExecutionState,
  BridgeTransferDraft,
} from "./bridge-types";
import {
  summarizeEstimate,
  validateBridgeDraft,
} from "./bridge-utils";
import { useUsdcBalance } from "./use-usdc-balance";
import { useBridgeSupportedDestinations } from "./use-bridge-supported-routes";

function compactBalance(value: string): string {
  const [whole, fraction = ""] = value.split(".");
  const compactFraction = fraction.slice(0, 6).replace(/0+$/, "");
  return compactFraction ? `${whole}.${compactFraction}` : whole;
}

export function BridgeForm({
  execution,
  onBridge,
  estimateTransfer,
}: {
  execution: BridgeExecutionState;
  onBridge: (draft: BridgeTransferDraft) => Promise<void>;
  estimateTransfer: (draft: BridgeTransferDraft) => Promise<BridgeEstimate>;
}) {
  const { login } = usePrivy();
  const wallet = useCanonicalWallet();
  const arc = arcCircleChain;
  const initialSource =
    circleEvmMainnetChains.find((chain) => chain.name === "Ethereum") ??
    circleEvmMainnetChains.find((chain) => chain.chainId !== arc.chainId) ??
    circleEvmMainnetChains[0];

  const [sourceId, setSourceId] = useState(initialSource.chainId);
  const [destinationId, setDestinationId] = useState(arc.chainId);
  const [amount, setAmount] = useState("");
  const [speed, setSpeed] = useState<TransferSpeed>(TransferSpeed.FAST);
  const [estimateState, setEstimateState] = useState<{
    key: string;
    value?: BridgeEstimate;
    pending: boolean;
    message?: string;
  }>({ key: "", pending: false });

  const source = getCircleChain(sourceId);
  const destination = getCircleChain(destinationId);
  const supportedDestinations = useBridgeSupportedDestinations(source);
  const recipient = wallet.address ? getAddress(wallet.address) : "";
  const balance = useUsdcBalance(source, wallet.address);

  const isActive = !["idle", "completed", "failed"].includes(
    execution.phase,
  );

  const routeSupported = Boolean(
    destination &&
      supportedDestinations.data?.some(
        (chain) => chain.chainId === destination.chainId,
      ),
  );

  const validationMessage = wallet.signerMismatch
    ? "The active wallet connector and signer addresses do not match. Reconnect the intended wallet before bridging."
    : supportedDestinations.isPending
      ? "Checking this USDC route with Circle Bridge Kit."
      : supportedDestinations.isError
        ? "Circle Bridge Kit could not verify supported routes. Try again before bridging."
        : !routeSupported
          ? "Circle Bridge Kit does not support the selected USDC route."
          : validateBridgeDraft({
              address: wallet.address,
              amount,
              balance: balance.data,
              source,
              destination,
              recipient,
            });

  const draft = useMemo<BridgeTransferDraft | undefined>(() => {
    if (validationMessage || !source || !destination || !wallet.address) {
      return undefined;
    }

    return {
      source,
      destination,
      amount: amount.trim(),
      recipient: getAddress(wallet.address),
      transferSpeed: speed,
    };
  }, [amount, destination, source, speed, validationMessage, wallet.address]);

  const estimateKey = draft
    ? `${draft.source.chainId}:${draft.destination.chainId}:${draft.amount}:${draft.recipient}:${draft.transferSpeed}`
    : "";

  useEffect(() => {
    if (!draft || wallet.chainId !== draft.source.chainId || isActive) return;

    const timeout = window.setTimeout(() => {
      setEstimateState({ key: estimateKey, pending: true });

      void estimateTransfer(draft)
        .then((result) =>
          setEstimateState({
            key: estimateKey,
            value: result,
            pending: false,
          }),
        )
        .catch(() => {
          setEstimateState({
            key: estimateKey,
            pending: false,
            message:
              "A cost estimate is unavailable right now. Circle Bridge Kit will validate the route again before submission.",
          });
        });
    }, 450);

    return () => window.clearTimeout(timeout);
  }, [draft, estimateKey, estimateTransfer, isActive, wallet.chainId]);

  const swapDirection = () => {
    setSourceId(destinationId);
    setDestinationId(sourceId);
  };

  const selectSource = (chainId: number) => {
    setSourceId(chainId);
    if (chainId === destinationId) setDestinationId(sourceId);
  };

  const selectDestination = (chainId: number) => {
    setDestinationId(chainId);
    if (chainId === sourceId) setSourceId(destinationId);
  };

  const currentEstimate =
    estimateState.key === estimateKey ? estimateState : undefined;

  const estimateLines = summarizeEstimate(
    currentEstimate?.value,
    circleEvmMainnetChains,
  );

  return (
    <section className="bridge-card" aria-labelledby="bridge-form-title">
      <div className="bridge-card-heading">
        <div>
          <p className="eyebrow">Circle CCTP V2</p>
          <h2 id="bridge-form-title">Transfer details</h2>
        </div>

        <span className="bridge-mainnet-pill">Mainnet only</span>
      </div>

      <div className="bridge-network-panel">
        <BridgeChainSelector
          id="bridge-source"
          label="From"
          value={sourceId}
          chains={circleEvmMainnetChains.filter(
            (chain) => chain.chainId !== destinationId,
          )}
          disabled={isActive}
          onChange={selectSource}
        />

        <button
          className="bridge-swap-button"
          type="button"
          onClick={swapDirection}
          disabled={isActive}
          aria-label="Swap source and destination networks"
          title="Swap direction"
        >
          <ArrowDownUp aria-hidden="true" size={18} />
        </button>

        <BridgeChainSelector
          id="bridge-destination"
          label="To"
          value={destinationId}
          chains={circleEvmMainnetChains.filter(
            (chain) =>
              chain.chainId !== sourceId &&
              supportedDestinations.data?.some(
                (supported) => supported.chainId === chain.chainId,
              ),
          )}
          disabled={isActive}
          loading={supportedDestinations.isPending}
          onChange={selectDestination}
        />
      </div>

      <label className="bridge-amount-field" htmlFor="bridge-amount">
        <span className="bridge-field-heading">
          <span className="field-label">Amount</span>
          <span>
            USDC balance:{" "}
            {balance.isPending
              ? "Loading…"
              : balance.isError
                ? "Unavailable"
                : `${compactBalance(balance.data?.formatted ?? "0")} USDC`}
          </span>
        </span>

        <span className="bridge-amount-input-row">
          <input
            id="bridge-amount"
            type="text"
            inputMode="decimal"
            autoComplete="off"
            placeholder="0.00"
            value={amount}
            disabled={isActive}
            onChange={(event) => setAmount(event.target.value)}
          />

          <strong>USDC</strong>

          <button
            type="button"
            disabled={
              isActive || !balance.data || balance.data.value === BigInt(0)
            }
            onClick={() => setAmount(balance.data?.formatted ?? "")}
          >
            Max
          </button>
        </span>
      </label>

      <div className="bridge-recipient">
        <WalletCards aria-hidden="true" size={18} />

        <div>
          <span className="field-label">Destination wallet</span>
          <code title={recipient || undefined}>
            {recipient || "Connect a wallet to set the recipient"}
          </code>
          <small>USDC is sent to the same connected EVM address.</small>
        </div>
      </div>

      <fieldset className="bridge-speed" disabled={isActive}>
        <legend className="field-label">Transfer speed</legend>

        <label>
          <input
            type="radio"
            name="bridge-speed"
            value={TransferSpeed.FAST}
            checked={speed === TransferSpeed.FAST}
            onChange={() => setSpeed(TransferSpeed.FAST)}
          />

          <span>
            <strong>Fast</strong>
            <small>Circle&apos;s faster CCTP finality option</small>
          </span>
        </label>

        <label>
          <input
            type="radio"
            name="bridge-speed"
            value={TransferSpeed.SLOW}
            checked={speed === TransferSpeed.SLOW}
            onChange={() => setSpeed(TransferSpeed.SLOW)}
          />

          <span>
            <strong>Standard</strong>
            <small>Standard CCTP finality</small>
          </span>
        </label>
      </fieldset>

      <dl className="bridge-summary">
        <div>
          <dt>Source network</dt>
          <dd>{source?.title ?? source?.name}</dd>
        </div>

        <div>
          <dt>Destination network</dt>
          <dd>{destination?.title ?? destination?.name}</dd>
        </div>

        <div>
          <dt>Asset</dt>
          <dd>USDC</dd>
        </div>

        <div>
          <dt>Transfer technology</dt>
          <dd>Circle CCTP V2</dd>
        </div>

        <div className="bridge-summary-wide">
          <dt>Estimated route cost</dt>
          <dd>
            {currentEstimate?.pending
              ? "Estimating with Circle…"
              : estimateLines.length > 0
                ? estimateLines.join(" + ")
                : wallet.chainId !== sourceId
                  ? "Available after switching to the source network"
                  : currentEstimate?.message ?? "No fee estimate returned"}
          </dd>
        </div>

        <div className="bridge-summary-wide">
          <dt>Finality</dt>
          <dd>
            Finality depends on the selected source and destination networks.
          </dd>
        </div>
      </dl>

      {validationMessage && wallet.address && (
        <div className="bridge-validation" role="status">
          <Info aria-hidden="true" size={17} />
          <span>{validationMessage}</span>
        </div>
      )}

      {balance.isError && (
        <div
          className="bridge-validation bridge-validation-error"
          role="alert"
        >
          <CircleAlert aria-hidden="true" size={17} />
          <span>
            Could not read the Circle-listed USDC balance on this network.
          </span>
        </div>
      )}

      {!wallet.address ? (
        <button
          className="button button-primary button-large bridge-submit"
          type="button"
          onClick={login}
        >
          Connect wallet
        </button>
      ) : (
        <button
          className="button button-primary button-large bridge-submit"
          type="button"
          disabled={!draft || isActive}
          onClick={() => draft && void onBridge(draft)}
        >
          {isActive
            ? "Transfer in progress…"
            : `Bridge ${amount || "0"} USDC`}
        </button>
      )}

      <p className="bridge-safety-note">
        Your connected Privy or external wallet signs every transaction.
        OmsetPro never receives wallet keys or custody of bridge funds.
      </p>
    </section>
  );
}