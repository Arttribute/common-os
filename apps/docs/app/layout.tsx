import type { Metadata } from "next";
import { Space_Grotesk } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider/next";
import type { ReactNode } from "react";
import { rootThemeVars } from "@/lib/theme";
import "./global.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
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
    <html lang="en" className={`${spaceGrotesk.variable} dark`} suppressHydrationWarning>
      <body className="flex min-h-screen flex-col" style={rootThemeVars}>
        <RootProvider theme={{ defaultTheme: "dark", enableSystem: false }}>
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
