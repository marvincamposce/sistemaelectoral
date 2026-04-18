import { ElectionTabs } from "../../components/election/ElectionTabs";

export default async function ElectionLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const resolved = await params;
  const electionIdStr = String(resolved.id);

  return (
    <div>
      <ElectionTabs electionIdStr={electionIdStr} />
      {children}
    </div>
  );
}
