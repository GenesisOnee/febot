"use client";

import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import SyncDialog from "./SyncDialog";

// 审阅页顶部沿用的同步入口；工作台内直接由 TaskBoard 的图标打开同一个弹窗。

export default function SyncButton({ defaultUser = "" }: { defaultUser?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <RefreshCw className="h-4 w-4" />
        同步
      </Button>
      <SyncDialog open={open} onOpenChange={setOpen} defaultUser={defaultUser} />
    </>
  );
}