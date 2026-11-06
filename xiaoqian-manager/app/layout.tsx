import type { Metadata } from "next";
import { ThemeProvider } from "next-themes";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Toaster } from "@/components/ui/sonner";
import { isDemoMode } from "@/lib/server/demo";
import "./globals.css";

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
    <html lang="zh-CN" suppressHydrationWarning>
      <body className="min-h-screen antialiased">
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
