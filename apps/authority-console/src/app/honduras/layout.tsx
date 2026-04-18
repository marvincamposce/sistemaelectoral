import { HondurasTabs } from "../components/honduras/HondurasTabs";

export default function HondurasLayout({ children }: { children: React.ReactNode }) {
  return (
    <div>
      <HondurasTabs />
      {children}
    </div>
  );
}
