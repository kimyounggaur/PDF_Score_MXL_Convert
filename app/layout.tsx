import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PDF Score to MXL",
  description: "PDF score to MusicXML compressed MXL converter"
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
