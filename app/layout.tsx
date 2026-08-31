import "./globals.css";

export const metadata = {
  title: "Golf Bets",
  description: "Apuestas de golf, liquidación e histórico",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="es"><body>{children}</body></html>;
}
