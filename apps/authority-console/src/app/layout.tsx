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
  title: "BlockUrna · Consola de Autoridad",
  description: "Centro de Comando de Autoridad Electoral Abstracta — gestión de elecciones BU-PVP-1",
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
                <div className="app-title">Consola de autoridad</div>
              </div>
              <nav className="app-nav" aria-label="Aplicaciones">
                <Link href="http://localhost:3012/" className="app-navlink app-navlink-active">Autoridad</Link>
                <Link href="http://localhost:3004/" className="app-navlink">Ciudadanía</Link>
                <Link href="http://localhost:3005/" className="app-navlink">Escrutinio</Link>
                <Link href="http://localhost:3011/" className="app-navlink">Observer</Link>
              </nav>
            </div>
          </header>
          <div className="app-frame app-content">
            {children}
          </div>
        </div>
      </body>
    </html>
  );
}
