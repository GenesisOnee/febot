import type { FebotDesktopApi } from "../shared/types";

declare global {
  interface Window {
    febotDesktop: FebotDesktopApi;
  }
}

export {};