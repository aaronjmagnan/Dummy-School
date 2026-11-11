import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dummy School",
  description: "A fake school district that answers like Aeries, Clever, and PowerSchool.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
