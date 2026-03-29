import type { Metadata } from "next";
import { Inter } from "next/font/google";

import "@solana/wallet-adapter-react-ui/styles.css";

import "@/app/globals.css";
import { Providers } from "@/components/providers";

const inter = Inter({
  subsets: ["latin", "cyrillic"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fortis Marketplace",
  description: "Web2 marketplace for Fortis RWA listings, orders, and webhook orchestration.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" suppressHydrationWarning>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
