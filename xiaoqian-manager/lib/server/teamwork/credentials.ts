import { readTeamworkConfig } from "@/lib/server/config/root";

// 协作平台登录凭证，与其余 teamwork 配置统一来自 febot.config.json 的 teamwork 段。
// password 是前端 JS 加密后的密文，原样透传给登录接口，
// 不要解密、不要尝试明文（会累计失败次数）。
// 凭证只留在服务端，绝不进入任何返回给浏览器的 JSON。
//
// 平台地址不在本模块：唯一来源是 teamwork.base（见 client.ts 的 baseUrl）。

export interface TwCredentials {
  loginName: string;
  password: string;
}

export function hasCredentials(): boolean {
  const c = readTeamworkConfig();
  return c.loginName !== "" && c.password !== "";
}

export function readCredentials(): TwCredentials {
  const c = readTeamworkConfig();
  if (!c.loginName || !c.password) {
    throw new Error(
      "未配置协作平台账号（原因：teamwork.loginName / teamwork.password 为空）。" +
        "下一步：在「设置 → 协作平台」填写账号与密码（密码会先加密再保存）后重试。"
    );
  }
  return { loginName: c.loginName, password: c.password };
}
