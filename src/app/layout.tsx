import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Expense Decision Benchmark",
  description: "Jev versus DeepSeek Flash on 1,000 expense claims.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
