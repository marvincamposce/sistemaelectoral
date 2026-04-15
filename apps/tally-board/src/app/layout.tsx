import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "BlockUrna · Tally Board (JED)",
  description: "Junta de Escrutinio Digital del Ecosistema BlockUrna",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className="antialiased bg-neutral-900 text-neutral-100 min-h-screen">
        <div className="mx-auto max-w-4xl p-6 sm:p-10 space-y-8">
          <header className="border-b border-neutral-700 pb-4">
            <h1 className="text-2xl font-bold tracking-tight text-white">Tally Board (JED)</h1>
            <p className="text-sm text-neutral-400">Junta de Escrutinio Digital · Módulo Computacional</p>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
