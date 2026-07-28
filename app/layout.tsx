import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "사용성테스트 결과보고서 자동생성",
  description: "raw data를 업로드하면 사용성테스트 결과보고서를 자동 생성합니다.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
