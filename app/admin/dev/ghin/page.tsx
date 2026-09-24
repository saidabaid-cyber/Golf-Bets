import { notFound } from "next/navigation";
import { connection } from "next/server";

import GhinDiagnosticClient from "./ghin-diagnostic-client";

export const metadata = {
  title: "GHIN read-only diagnostic · The Backyard Admin",
  robots: { index: false, follow: false },
};

export default async function GhinDiagnosticPage() {
  await connection();
  if (process.env.VERCEL_ENV !== "preview") notFound();
  return <GhinDiagnosticClient />;
}
