import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockUrna · Voter Portal",
  description: "Portal Experimental de Votación del Ecosistema BlockUrna",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased bg-neutral-50 text-neutral-900 min-h-screen">
        <div className="mx-auto max-w-xl p-6 sm:p-10 space-y-8">
          <header className="border-b border-neutral-200 pb-4">
            <h1 className="text-2xl font-bold tracking-tight">BlockUrna Voter Portal</h1>
            <p className="text-sm text-neutral-500">Instancia Experimental · BU-PVP-1</p>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
