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
  title: "BlockUrna · Portal de Votación",
  description: "Portal de votación asistida BU-PVP-1 para entorno local reproducible",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body className={`${manrope.variable} min-h-screen`}>
        <div className="mx-auto max-w-3xl p-6 sm:p-10 space-y-8">
          <header className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">BlockUrna · Portal de Votación</h1>
              <span className="badge badge-info">Sistema BU-PVP-1</span>
            </div>
            <p className="text-sm text-slate-500 mt-2">
              Flujo de inscripción y emisión de boleta cifrada para entorno local reproducible.
            </p>
          </header>
          {children}
        </div>
      </body>
    </html>
  );
}
