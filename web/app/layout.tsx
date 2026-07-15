import type { Metadata } from "next";
import { SiteFooter } from "@/components/site-footer";
import "./styles.css";

export const metadata: Metadata = {
  title: "CompassAi",
  description: "Secure online CompassQA call transcription and QA review."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        {children}
        <SiteFooter />
      </body>
    </html>
  );
}
