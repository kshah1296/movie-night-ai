import type { Metadata } from "next";
import Nav from "@/components/Nav";
import "./globals.css";

export const metadata: Metadata = {
  title: "Movie Night AI",
  description: "AI-powered movie recommendations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full flex flex-col" style={{ background: "#09090b", color: "#fafafa" }}>
        <Nav />
        <main style={{ flex: 1, maxWidth: 1100, margin: "0 auto", width: "100%", padding: "2rem 1.5rem" }}>
          {children}
        </main>
      </body>
    </html>
  );
}
