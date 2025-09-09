declare module 'playwright-extra' {
  import type { BrowserType } from 'playwright';
  export const chromium: BrowserType & { use: (plugin: any) => void };
}

declare module 'puppeteer-extra-plugin-stealth' {
  const stealth: () => any;
  export default stealth;
}

