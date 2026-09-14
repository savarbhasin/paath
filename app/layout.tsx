import type { Metadata } from "next";
import { DM_Mono, DM_Sans, Lora, Space_Grotesk } from "next/font/google";

import { AppSidebar } from "@/components/app-sidebar";
import "./globals.css";
import "katex/dist/katex.min.css";

export const metadata: Metadata = {
  title: "Paath | Learning workspace",
  description: "Your space to study deeply.",
};

const heading = Space_Grotesk({ subsets: ["latin"], variable: "--font-heading-next", weight: ["400", "500", "600", "700"] });
const body = DM_Sans({ subsets: ["latin"], variable: "--font-body-next", weight: ["400", "500", "600"] });
const mono = DM_Mono({ subsets: ["latin"], variable: "--font-mono-next", weight: ["400", "500"] });
const brand = Lora({ subsets: ["latin"], variable: "--font-brand-next", weight: ["600"], display: "swap" });

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${heading.variable} ${body.variable} ${mono.variable} ${brand.variable} bg-bg font-body text-text antialiased`}>
        <div className="flex min-h-screen w-full">
          <AppSidebar />
          <div className="min-w-0 flex-1">{children}</div>
        </div>
      </body>
    </html>
  );
}
