import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Chennai Metro 3D Tracking | MapLibre GL JS",
  description: "Interactive 3D transit tracking and map visualization for Chennai Metro (CMRL) with 3D buildings.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Host+Grotesk:ital,wght@0,300..800;1,300..800&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
