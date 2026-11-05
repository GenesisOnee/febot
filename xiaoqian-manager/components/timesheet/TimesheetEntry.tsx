import { Clock } from "lucide-react";
import { Button } from "@/components/ui/button";

// 今日工时：只做页面跳转，直接打开协作平台的工时页面。
// 地址通过 NEXT_PUBLIC_TIMESHEET_URL 配置；未配置时不显示入口。
const TIMESHEET_URL = process.env.NEXT_PUBLIC_TIMESHEET_URL || "";

export default function TimesheetEntry() {
  if (!TIMESHEET_URL) return null;
  return (
    <Button variant="outline" asChild>
      <a href={TIMESHEET_URL} target="_blank" rel="noopener noreferrer">
        <Clock className="h-4 w-4" />
        今日工时
      </a>
    </Button>
  );
}
