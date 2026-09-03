import { redirect } from "next/navigation";

export default async function PollaInvitePage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  redirect(`/?polla=${encodeURIComponent(code.trim())}`);
}
