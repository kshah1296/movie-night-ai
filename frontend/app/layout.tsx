import type { Metadata } from "next";
import Nav from "@/components/Nav";
import CommandPalette from "@/components/CommandPalette";
import { ToastProvider } from "@/components/ToastProvider";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "Movie Night AI",
  description: "AI-powered movie recommendations",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        {/* UX8 — apply the saved theme before first paint (no flash) */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className="min-h-full flex flex-col" style={{ background: "var(--bg)", color: "var(--text-1)" }}>
        <ToastProvider>
          <Nav />
          <CommandPalette />
          <main style={{ flex: 1, maxWidth: 1100, margin: "0 auto", width: "100%", padding: "2rem 1.5rem" }}>
            {children}
          </main>
        </ToastProvider>
      </body>
    </html>
  );
}
