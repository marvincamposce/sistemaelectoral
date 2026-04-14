import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockUrna · Sistema de Votación",
  description: "dApp de votación en blockchain con registro, aprobación y conteo transparente",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
