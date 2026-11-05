"use client";

import { UserRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

// 首期无登录：左下角只显示本机占位用户。组件边界保留，后续替换为昵称首字母与用户菜单。

export default function UserMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <>
      <Button
        variant="ghost"
        className="h-9 w-full justify-start gap-2 px-2"
        onClick={() => onOpenChange(true)}
        title="本机用户"
      >
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
          <UserRound className="h-3.5 w-3.5" />
        </span>
        <span className="truncate text-sm">本地</span>
      </Button>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>本机单用户模式</DialogTitle>
            <DialogDescription>
              当前不需要登录，所有数据保存在本机。登录、注册与远程管理将在后续版本开放。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => onOpenChange(false)}>知道了</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}