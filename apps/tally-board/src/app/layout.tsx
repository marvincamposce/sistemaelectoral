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
  title: "BlockUrna · Panel de Escrutinio (JED)",
  description: "Junta de Escrutinio Digital del ecosistema BlockUrna",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${manrope.variable} min-h-screen`}>
        <div className="mx-auto max-w-5xl p-6 sm:p-10 space-y-8">
          <header className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Panel de Escrutinio (JED)</h1>
              <span className="badge badge-info">Operación de Escrutinio</span>
            </div>
            <p className="text-sm text-slate-500 mt-2">
              Junta de Escrutinio Digital con descifrado real, transcript verificable y custodia 2-de-3.
            </p>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
