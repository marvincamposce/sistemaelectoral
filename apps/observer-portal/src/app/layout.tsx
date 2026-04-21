import type { Metadata } from "next";
import Link from "next/link";
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
      <body className={manrope.variable}>
        <div className="app-shell">
          <header className="app-topbar">
            <div className="app-frame app-topbar-inner">
              <div>
                <div className="app-kicker">BlockUrna</div>
                <div className="app-title">Observatorio electoral</div>
              </div>
              <nav className="app-nav" aria-label="Aplicaciones">
                <Link href="https://sistemaelectoral-authority-console.vercel.app/" className="app-navlink">Autoridad</Link>
                <Link href="https://sistemaelectoral-voter-portal.vercel.app/" className="app-navlink">Ciudadanía</Link>
                <Link href="https://sistemaelectoral-tally-board.vercel.app/" className="app-navlink">Escrutinio</Link>
                <Link href="https://sistemaelectoral-observer-portal.vercel.app/" className="app-navlink app-navlink-active">Observer</Link>
              </nav>
            </div>
          </header>
          <div className="app-frame app-content">{children}</div>
        </div>
      </body>
    </html>
  );
}
