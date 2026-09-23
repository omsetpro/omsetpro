import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Handshake,
  KeyRound,
  RotateCcw,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { AuthButton } from "@/components/auth/auth-button";
import { SiteHeader } from "@/components/layout/site-header";
import { omsetProContract } from "@/lib/web3/contract";

const steps = [
  {
    number: "01",
    icon: Handshake,
    title: "Structure the agreement",
    description:
      "Record the asset, counterparties, collateral amount, deadlines, and neutral arbiter onchain.",
  },
  {
    number: "02",
    icon: KeyRound,
    title: "Fund in native USDC",
    description:
      "The borrower funds the escrow and protocol fee in one transaction on Arc Mainnet.",
  },
  {
    number: "03",
    icon: RotateCcw,
    title: "Settle with clarity",
    description:
      "Return, refund, claim, and dispute paths distribute only the recorded collateral amount.",
  },
];

export default function Home() {
  return (
    <div className="app-frame">
      <SiteHeader actions={<AuthButton />} />

      <main>
        <section className="hero site-shell">
          <div className="hero-copy">
            <p className="eyebrow">Physical-asset financing · Arc Mainnet</p>
            <h1>Finance real assets with transparent USDC collateral.</h1>
            <p className="hero-lede">
              OmsetPro gives asset owners and borrowers a clear onchain agreement,
              native-USDC escrow, defined deadlines, and deterministic settlement
              rules—without asking either party to custody the other&apos;s collateral.
            </p>
            <div className="hero-actions">
              <Link className="button button-primary button-large" href="/dashboard">
                Explore agreements
                <ArrowRight aria-hidden="true" size={18} />
              </Link>
              <a
                className="text-link"
                href={omsetProContract.explorerUrl}
                target="_blank"
                rel="noreferrer"
              >
                View verified contract
                <ArrowUpRight aria-hidden="true" size={16} />
              </a>
            </div>
            <div className="plain-language-note">
              <ShieldCheck aria-hidden="true" size={20} />
              <p>
                Principal remains isolated from the 1% protocol fee, and every
                lifecycle action is visible onchain.
              </p>
            </div>
          </div>

          <div className="checkout-card" aria-label="How an OmsetPro financing agreement works">
            <div className="checkout-card-top">
              <span>OMSETPRO</span>
              <span>FINANCING OVERVIEW</span>
            </div>
            <div className="checkout-title-row">
              <div>
                <span className="field-label">Agreement type</span>
                <strong>Physical asset</strong>
              </div>
              <span className="checkout-stamp">PROTECTED</span>
            </div>
            <div className="checkout-lines">
              <div>
                <span>Collateral</span>
                <strong>Native USDC escrow</strong>
              </div>
              <div>
                <span>Network</span>
                <strong>Arc Mainnet</strong>
              </div>
              <div>
                <span>Protocol fee</span>
                <strong>1% at funding</strong>
              </div>
            </div>
            <div className="checkout-footer">
              <Check aria-hidden="true" size={18} />
              <span>Verifiable roles, deadlines, and settlement.</span>
            </div>
          </div>
        </section>

        <section className="process-section" aria-labelledby="process-title">
          <div className="site-shell">
            <div className="section-heading">
              <div>
                <p className="eyebrow">How OmsetPro works</p>
                <h2 id="process-title">From asset terms to final settlement.</h2>
              </div>
              <p>
                Every participant can review the same funding and settlement
                rules before the physical asset changes hands.
              </p>
            </div>
            <ol className="process-list">
              {steps.map((step) => {
                const Icon = step.icon;
                return (
                  <li key={step.number}>
                    <span className="step-number">{step.number}</span>
                    <Icon aria-hidden="true" size={22} />
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </li>
                );
              })}
            </ol>
          </div>
        </section>

        <section className="proof-section site-shell" aria-labelledby="proof-title">
          <div>
            <p className="eyebrow">Verifiable infrastructure</p>
            <h2 id="proof-title">Built for accountable transactions.</h2>
          </div>
          <p>
            OmsetPro runs on Arc Mainnet. Review the deployed contract, track
            transactions, and verify the agreement lifecycle directly.
          </p>
          <a
            className="button button-secondary"
            href={omsetProContract.explorerUrl}
            target="_blank"
            rel="noreferrer"
          >
            View contract on explorer
            <ArrowUpRight aria-hidden="true" size={16} />
          </a>
        </section>
      </main>

      <footer className="site-footer">
        <div className="site-shell">
          <span>OmsetPro</span>
          <span>Physical-asset financing with native USDC on Arc Mainnet.</span>
        </div>
      </footer>
    </div>
  );
}
