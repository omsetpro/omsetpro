"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LogIn, ShieldCheck } from "lucide-react";
import { WalletDashboard } from "@/features/wallet/wallet-dashboard";

export function DashboardGate() {
  const { ready, authenticated, login } = usePrivy();

  if (!ready) {
    return (
      <main className="dashboard-main site-shell" aria-busy="true">
        <div className="auth-loading">
          <span className="loading-mark" aria-hidden="true" />
          <p>Checking your OmsetPro session…</p>
        </div>
      </main>
    );
  }

  if (!authenticated) {
    return (
      <main className="dashboard-main site-shell">
        <section className="signin-sheet" aria-labelledby="signin-title">
          <div className="signin-icon" aria-hidden="true">
            <ShieldCheck size={28} />
          </div>
          <p className="eyebrow">Dashboard access</p>
          <h1 id="signin-title">Access your item lending workspace.</h1>
          <p>
            Sign in to discover agreements tied to your wallet, monitor native-USDC
            security deposits, and complete authorized lifecycle actions.
          </p>
          <button className="button button-primary button-large" type="button" onClick={login}>
            <LogIn aria-hidden="true" size={18} />
            Sign in to OmsetPro
          </button>
          <small>No private key entry. No transaction is sent by signing in.</small>
        </section>
      </main>
    );
  }

  return (
    <main className="dashboard-main site-shell">
      <WalletDashboard />
    </main>
  );
}
