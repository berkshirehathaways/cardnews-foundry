export type RenderEnvironment = Readonly<{
  playwrightVersion: string;
  chromiumRevision: string;
  locale: string;
  timezone: string;
  viewport: Readonly<{ width: number; height: number }>;
  deviceScaleFactor: number;
  canonicalLinuxImage: string;
}>;

export const pinnedRenderEnvironment: RenderEnvironment = {
  playwrightVersion: "1.62.0",
  chromiumRevision: "1234",
  locale: "ko-KR",
  timezone: "Asia/Seoul",
  viewport: { width: 1080, height: 1350 },
  deviceScaleFactor: 1,
  canonicalLinuxImage: "mcr.microsoft.com/playwright:v1.62.0-noble"
};
