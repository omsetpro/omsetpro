import type { ReactNode } from "react";
import Link from "next/link";
import { Brand } from "@/components/layout/brand";

export function SiteHeader({ actions }: { actions: ReactNode }) {
  return (
    <header className="site-header">
      <div className="site-shell site-header-inner">
        <Brand />
        <div className="site-header-controls">
          <nav className="primary-nav" aria-label="Primary navigation">
            <Link href="/">Overview</Link>
            <Link href="/dashboard">Dashboard</Link>
            <Link href="/create">Create</Link>
            <Link href="/bridge">Bridge</Link>
          </nav>
          <div className="account-actions">{actions}</div>
        </div>
      </div>
    </header>
  );
}
