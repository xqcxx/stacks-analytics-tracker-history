import type { Metadata } from "next";
import { JetBrains_Mono, Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
});

const jetBrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains-mono",
  weight: ["400", "500", "700"],
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "TraceLayer Analytics",
  description: "On-chain product analytics tracker on Stacks.",
  openGraph: {
    title: "TraceLayer Analytics",
    description: "On-chain product analytics tracker on Stacks.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "TraceLayer Analytics",
    description: "On-chain product analytics tracker on Stacks.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${manrope.variable} ${jetBrainsMono.variable}`}>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
