import type { Metadata } from "next";
import { AuthButton } from "@/components/auth/auth-button";
import { SiteHeader } from "@/components/layout/site-header";
import { BridgeScreen } from "@/features/bridge/bridge-screen";

export const metadata: Metadata = {
  title: "Bridge USDC",
  description:
    "Move USDC between Arc Mainnet and supported EVM networks with Circle CCTP.",
};

export default function BridgePage() {
  return (
    <div className="app-frame dashboard-frame">
      <SiteHeader actions={<AuthButton compact />} />
      <BridgeScreen />
    </div>
  );
}
