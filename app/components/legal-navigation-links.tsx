"use client";

import Link from "next/link";
import { useEffect, useState, type ReactNode } from "react";
import { legalReturnDestination, preserveLegalReturn } from "../../lib/legal-navigation";

function currentReturnContext() {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("returnTo");
}

export function LegalBackLink({ className }: { className?: string }) {
  const [destination, setDestination] = useState(() => legalReturnDestination(null));
  useEffect(() => setDestination(legalReturnDestination(currentReturnContext())), []);
  return <Link href={destination.href} className={className} aria-label={destination.label.replace(/^←\s*/, "")}>{destination.label}</Link>;
}

export function LegalDocumentLink({ href, children }: { href: string; children: ReactNode }) {
  const [destination, setDestination] = useState(href);
  useEffect(() => setDestination(preserveLegalReturn(href, currentReturnContext())), [href]);
  return <Link href={destination}>{children}</Link>;
}
