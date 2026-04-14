import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockUrna · Landing",
  description: "Sistema de votación en blockchain (proyecto universitario)",
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
