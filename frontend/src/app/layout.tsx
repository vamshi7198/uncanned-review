import type { Metadata, Viewport } from "next";

import { SessionProvider } from "@/components/session";
import { ToastProvider } from "@/components/toast";

import "./globals.css";

export const metadata: Metadata = {
  title: "Uncanned Review",
  description: "Private video review and approval",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#0e0f11",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh antialiased">
        <SessionProvider>
          <ToastProvider>{children}</ToastProvider>
        </SessionProvider>
      </body>
    </html>
  );
}
