import type { Metadata } from "next";
import { Inter, Outfit } from "next/font/google";
import { Sidebar } from "./components/Sidebar";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

const outfit = Outfit({
  subsets: ["latin"],
  variable: "--font-display",
});

export const metadata: Metadata = {
  title: "BlockUrna · Consola AEA",
  description: "Centro de Comando de Autoridad Electoral Abstracta",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className={`${inter.variable} ${outfit.variable}`}>
      <body className="antialiased">
        <div className="admin-layout">
          <Sidebar />

          {/* Main Content Area */}
          <main className="admin-main">
            <header className="admin-topbar">
              <div className="text-sm font-semibold text-slate-500 uppercase tracking-wide">
                Consola de Operación (BU-PVP-1)
              </div>
              <div className="flex items-center gap-3">
                <span className="flex h-3 w-3 relative">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                </span>
                <span className="text-sm font-medium text-slate-600">Conexión Segura</span>
              </div>
            </header>
            <div className="admin-content">
              {children}
            </div>
          </main>
        </div>
      </body>
    </html>
  );
}
