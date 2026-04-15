import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockUrna · Consola AEA",
  description:
    "Consola de Autoridad Electoral Abstracta (BU-PVP-1). Uso experimental para investigación.",
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
