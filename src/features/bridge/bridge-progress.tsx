import {
  ArrowUpRight,
  Check,
  CircleAlert,
  LoaderCircle,
  RotateCcw,
} from "lucide-react";
import type { BridgeExecutionState } from "./bridge-types";
import { completedTransferSummary, phaseLabel } from "./bridge-utils";

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function BridgeProgress({
  state,
  onReset,
  onResume,
  canResume,
}: {
  state: BridgeExecutionState;
  onReset: () => void;
  onResume: () => void;
  canResume: boolean;
}) {
  if (state.phase === "idle") return null;

  const terminal = ["completed", "failed", "pending-finalization"].includes(
    state.phase,
  );
  const positive = state.phase === "completed";
  const pending = state.phase === "pending-finalization";

  return (
    <section
      className={`bridge-progress bridge-progress-${positive ? "success" : pending ? "pending" : state.phase === "failed" ? "error" : "active"}`}
      aria-live="polite"
      aria-labelledby="bridge-progress-title"
    >
      <div className="bridge-progress-heading">
        <div className="bridge-progress-icon" aria-hidden="true">
          {positive ? (
            <Check size={20} />
          ) : state.phase === "failed" ? (
            <CircleAlert size={20} />
          ) : (
            <LoaderCircle className={terminal ? undefined : "spin"} size={20} />
          )}
        </div>
        <div>
          <p className="eyebrow">Transfer progress</p>
          <h2 id="bridge-progress-title">{phaseLabel(state.phase)}</h2>
          {state.draft && terminal && (
            <p>{completedTransferSummary(state.draft)}</p>
          )}
        </div>
      </div>

      {state.message && (
        <p className="bridge-progress-message" role="alert">
          {state.message}
        </p>
      )}

      {pending && (
        <p className="bridge-recovery-warning" role="status">
          Circle Bridge Kit confirms the source burn succeeded. Do not submit
          this transfer again. Resume the existing transfer to continue
          attestation or destination minting.
        </p>
      )}

      <ol className="bridge-timeline">
        {state.steps.length === 0 ? (
          <li className="bridge-step bridge-step-pending">
            <span className="bridge-step-marker" />
            <div>
              <strong>{phaseLabel(state.phase)}</strong>
              <span>Follow the prompts in your connected wallet.</span>
            </div>
          </li>
        ) : (
          state.steps.map((step) => (
            <li
              className={`bridge-step bridge-step-${step.state}`}
              key={step.id}
            >
              <span className="bridge-step-marker" />
              <div>
                <strong>{step.label}</strong>
                {step.chainName && <span>{step.chainName}</span>}
                {step.transactionHash && (
                  <span className="bridge-transaction-row">
                    <code title={step.transactionHash}>
                      {shortHash(step.transactionHash)}
                    </code>
                    {step.explorerUrl && (
                      <a
                        href={step.explorerUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        Explorer <ArrowUpRight aria-hidden="true" size={13} />
                      </a>
                    )}
                  </span>
                )}
                {step.detail && <span>{step.detail}</span>}
              </div>
            </li>
          ))
        )}
      </ol>

      {pending ? (
        <div className="bridge-recovery-actions">
          {canResume && (
            <button
              className="button button-primary"
              type="button"
              onClick={onResume}
            >
              Resume finalization
            </button>
          )}
          <button
            className="button button-secondary"
            type="button"
            onClick={onReset}
          >
            Leave transfer state
          </button>
        </div>
      ) : terminal ? (
        <button className="button button-secondary" type="button" onClick={onReset}>
          <RotateCcw aria-hidden="true" size={16} />
          Bridge another transfer
        </button>
      ) : null}
    </section>
  );
}
