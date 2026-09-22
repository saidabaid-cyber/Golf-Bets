import { CompetitionRules } from "./competition-rules";

export const metadata = { title: "Reglamento · The Backyard", robots: { index: false, follow: false } };

export default async function CompetitionRulesPage({ params }: { params: Promise<{ competitionId: string }> }) {
  const { competitionId } = await params;
  return <CompetitionRules competitionId={competitionId} />;
}
