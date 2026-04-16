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
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-screen">
        <div className="mx-auto max-w-5xl p-6 sm:p-10 space-y-8">
          <header className="card p-5">
            <div className="flex items-center justify-between gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-slate-900">Tally Board (JED)</h1>
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
