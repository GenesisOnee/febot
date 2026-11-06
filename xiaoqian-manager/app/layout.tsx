import type { Metadata } from "next";
import Script from "next/script";
import { JetBrains_Mono, Plus_Jakarta_Sans } from "next/font/google";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { isDemoMode } from "@/lib/server/demo";
import "./globals.css";

// 西文/数字用 Plus Jakarta Sans，等宽用 JetBrains Mono；
// 中文字形不随这两个字体下载，交给下面的中文 fallback 栈。
const sansFont = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-sans-latin",
  display: "swap",
});

const monoFont = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-latin",
  display: "swap",
});

export const metadata: Metadata = {
  title: "小前 · 前端工作流",
  description: "前端开发工作流管理",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      className={`${sansFont.variable} ${monoFont.variable}`}
      suppressHydrationWarning
    >
      <body className="min-h-screen antialiased">
        {/* 仅开发期：tweakcn 的 Custom 预览靠这个脚本回 PONG 并接收主题变量 */}
        {process.env.NODE_ENV === "development" && (
          <Script
            src="https://tweakcn.com/live-preview.min.js"
            strategy="beforeInteractive"
            crossOrigin="anonymous"
          />
        )}
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <TooltipProvider>{children}</TooltipProvider>
          <Toaster position="top-center" />
          {isDemoMode() && <DemoBanner />}
        </ThemeProvider>
      </body>
    </html>
  );
}

// 固定右下角，不参与三栏布局；真实安装说明见 README「快速开始」
function DemoBanner() {
  return (
    <div className="fixed bottom-3 right-3 z-50 max-w-xs rounded-lg border border-primary/30 bg-background/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <p className="font-medium text-foreground">演示模式</p>
      <p className="mt-0.5 text-muted-foreground">
        数据来自 <code className="font-mono">example/demo</code>，不会读写你的仓库。
      </p>
      <p className="mt-0.5 text-muted-foreground">
        要真正跑流水线：执行 <code className="font-mono">yarn setup</code> 后按 README 配置。
      </p>
    </div>
  );
}
