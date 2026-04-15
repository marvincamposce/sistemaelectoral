import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockUrna · Observatorio Electoral",
  description: "Portal público de observación electoral BU-PVP-1 — verificación de evidencias, actas ancladas y auditoría criptográfica",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      </head>
      <body>{children}</body>
    </html>
  );
}
