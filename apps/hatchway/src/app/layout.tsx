import type { Metadata } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";
import { ProjectProvider } from "@/contexts/ProjectContext";
import { RunnerProvider } from "@/contexts/RunnerContext";
import { AgentProvider } from "@/contexts/AgentContext";
import { AuthProvider } from "@/contexts/AuthContext";
import { ThemeProvider } from "@/contexts/ThemeContext";
import { QueryProvider } from "./providers";
import { ToastProvider } from "@/components/ui/toast";

// Check if running in local mode (set by runner)
const isLocalMode = process.env.HATCHWAY_LOCAL_MODE === "true";

const rubik = Rubik({
  subsets: ["latin"],
  variable: "--font-rubik",
  weight: ["300", "400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "Hatchway - Think it. Build it. Ship it.",
  description: "Build and ship applications locally. Build cool things, prototype new ideas, break them, and fix it faster with Sentry.",
  metadataBase: new URL("https://hatchway.app"),
  manifest: "/manifest.json",
  icons: {
    icon: [
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: [
      { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
    ],
  },
  openGraph: {
    title: "Hatchway - Think it. Build it. Ship it.",
    description: "Build and ship applications locally. Build cool things, prototype new ideas, break them, and fix it faster with Sentry.",
    url: "https://hatchway.app",
    siteName: "Hatchway",
    type: "website",
    images: [
      {
        url: "/og-image.png",
        width: 1536,
        height: 1024,
        alt: "Hatchway - Build Cool Things",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Hatchway - Think it. Build it. Ship it.",
    description: "Build and ship applications locally. Build cool things, prototype new ideas, break them, and fix it faster with Sentry.",
    images: ["/og-image.png"],
  },
  keywords: ["AI", "app builder", "code generation", "full-stack", "developer tools", "hatchway"],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark theme-dark">
      <body
        className={`${rubik.variable} font-sans antialiased`}
      >
        <QueryProvider>
          <ThemeProvider>
            <AuthProvider isLocalMode={isLocalMode}>
              <AgentProvider>
                <RunnerProvider>
                  <ProjectProvider>
                    <ToastProvider>
                      {children}
                    </ToastProvider>
                  </ProjectProvider>
                </RunnerProvider>
              </AgentProvider>
            </AuthProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
