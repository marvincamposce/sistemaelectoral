import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockUrna · Observación electoral",
  description: "Observer portal BU-PVP-1 (verificación pública, actas y evidencias)",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
