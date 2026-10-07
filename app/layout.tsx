import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stratoscope — Northern Hemisphere",
  description: "Live NOAA GFS temperature, wind and geopotential forecasts from 100 to 10 hPa.",
  icons: {
    icon: "/favicon.svg",
    shortcut: "/favicon.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">{children}</body>
    </html>
  );
}
