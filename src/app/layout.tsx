import type { Metadata } from "next";
import "./globals.css";
import { AvisoDemo } from "@/components/AvisoDemo";
import { esDemo } from "@/lib/demo";

export const metadata: Metadata = {
  title: "DISA · Administración de rentas",
  description: "Plataforma de administración de rentas de Casas y Terrenos DISA",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans">
        {esDemo() && <AvisoDemo />}
        {children}
      </body>
    </html>
  );
}
