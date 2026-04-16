import type { Metadata } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "BlockUrna · Observatorio Electoral",
  description: "Portal público de observación electoral BU-PVP-1 — verificación de evidencias, actas ancladas y auditoría criptográfica",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className={manrope.variable}>{children}</body>
    </html>
  );
}
