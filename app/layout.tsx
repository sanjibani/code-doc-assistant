import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Code Doc Assistant",
  description: "Ask questions about an indexed codebase. Cited answers with file:line references.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}