"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { LEGAL_APP_RETURN_KEY, legalAppReturnScreen, legalReturnDestination, preserveLegalReturn } from "../../lib/legal-navigation";

function currentReturnContext() {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("returnTo");
}

export function LegalBackLink({ className }: { className?: string }) {
  const [destination, setDestination] = useState(() => legalReturnDestination(null));
  useEffect(() => {
    const context = currentReturnContext();
    const appScreen = context === "app" ? legalAppReturnScreen(sessionStorage.getItem(LEGAL_APP_RETURN_KEY)) : null;
    setDestination(legalReturnDestination(context, appScreen));
  }, []);
  return <Link href={destination.href} className={className} aria-label={destination.label.replace(/^←\s*/, "")}>{destination.label}</Link>;
}

export function LegalDocumentLink({ href, children }: { href: string; children: ReactNode }) {
  const [destination, setDestination] = useState(href);
  useEffect(() => setDestination(preserveLegalReturn(href, currentReturnContext())), [href]);
  return <Link href={destination} onClick={() => window.dispatchEvent(new Event("backyard-before-legal-navigation"))}>{children}</Link>;
}
