import type { Metadata } from "next";
import { Inter, JetBrains_Mono } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { rootThemeVars } from "@/lib/theme";
import "./global.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "CommonOS Docs",
    template: "%s | CommonOS Docs",
  },
  description: "Documentation for deploying, operating, and observing CommonOS AI agent fleets.",
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col" style={rootThemeVars}>
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
