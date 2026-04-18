import { redirect } from "next/navigation";

export default async function ElectionIndexPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolved = await params;
  redirect(`/elections/${resolved.id}/dashboard`);
}
