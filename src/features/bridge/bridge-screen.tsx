"use client";

import { ArrowLeftRight, ShieldCheck } from "lucide-react";
import { BridgeForm } from "./bridge-form";
import { BridgeProgress } from "./bridge-progress";
import { circleEvmMainnetChains } from "./circle-bridge";
import { useCircleBridge } from "./use-circle-bridge";

export function BridgeScreen() {
  const bridge = useCircleBridge();

  return (
    <main className="bridge-page">
      <div className="site-shell">
        <header className="bridge-hero">
          <div>
            <p className="eyebrow">Cross-chain USDC</p>
            <h1>Bridge USDC</h1>
            <p>
              Move native USDC across supported EVM networks using Circle CCTP.
              Arc Mainnet is ready as a source or destination.
            </p>
          </div>
          <div className="bridge-trust-note">
            <ShieldCheck aria-hidden="true" size={22} />
            <div>
              <strong>Canonical, wallet-controlled transfers</strong>
              <span>
                Routes, USDC metadata, and execution come directly from Circle Bridge Kit.
              </span>
            </div>
          </div>
        </header>

        <div className="bridge-layout">
          <BridgeForm
            execution={bridge.state}
            onBridge={bridge.bridge}
            estimateTransfer={bridge.estimate}
          />
          <aside className="bridge-side-panel">
            <BridgeProgress
              state={bridge.state}
              onReset={bridge.reset}
              onResume={() => void bridge.resume()}
              canResume={bridge.canResume}
            />
            {bridge.state.phase === "idle" && (
              <div className="bridge-ready-panel">
                <span className="bridge-ready-icon">
                  <ArrowLeftRight aria-hidden="true" size={21} />
                </span>
                <p className="eyebrow">Ready when you are</p>
                <h2>A clear path from source to destination.</h2>
                <p>
                  Choose from {circleEvmMainnetChains.length} Circle-supported EVM mainnets. You will review the route before your wallet is asked to sign.
                </p>
                <ol>
                  <li>Select networks and amount</li>
                  <li>Approve and burn USDC on the source</li>
                  <li>Wait for Circle finality</li>
                  <li>Receive USDC on the destination</li>
                </ol>
              </div>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
