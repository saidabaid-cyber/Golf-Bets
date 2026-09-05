import "./globals.css";
import type { Viewport } from "next";
import { PwaRuntime } from "./components/pwa-runtime";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#173f2a",
};

export const metadata = {
  title: "THE BACKYARD",
  description: "Built for the games we play.",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: [
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-icon.png?v=3",
  },
  appleWebApp: {
    capable: true,
    title: "THE BACKYARD",
    statusBarStyle: "black-translucent" as const,
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body><PwaRuntime />{children}</body></html>;
}
