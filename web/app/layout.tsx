import type { Metadata } from "next";
import "./styles.css";

export const metadata: Metadata = {
  title: "CompassAi",
  description: "Secure online CompassQA call transcription and QA review."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}

