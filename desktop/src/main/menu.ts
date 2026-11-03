import { app, Menu, shell } from "electron";
import { logsDir } from "./paths";

export interface MenuActions {
  openWorkspace: () => void;
  openConfig: () => void;
  openLogs: () => void;
  restartNext: () => void;
  restartRunner: () => void;
  runDoctor: () => void;
  registerSwaggerMcp: () => void;
  checkUpdate: () => void;
  quit: () => void;
}

export function buildMenu(actions: MenuActions): void {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "文件",
      submenu: [
        { label: "打开工作区", click: actions.openWorkspace },
        { label: "打开配置文件", click: actions.openConfig },
        { label: "打开日志目录", click: actions.openLogs },
        { type: "separator" },
        { label: "退出", click: actions.quit },
      ],
    },
    {
      label: "服务",
      submenu: [
        { label: "重启 Next", click: actions.restartNext },
        { label: "重启 Runner", click: actions.restartRunner },
        { label: "环境自检", click: actions.runDoctor },
      ],
    },
    {
      label: "工具",
      submenu: [{ label: "配置 Swagger MCP", click: actions.registerSwaggerMcp }],
    },
    {
      label: "帮助",
      submenu: [
        { label: `版本 ${app.getVersion()}`, enabled: false },
        { label: "检查更新", click: actions.checkUpdate },
        {
          label: "打开日志",
          click: () => {
            void shell.openPath(logsDir());
          },
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}