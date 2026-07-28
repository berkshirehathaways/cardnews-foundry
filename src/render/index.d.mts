export type RenderResult = {
  readonly outputRoot: string;
  readonly cardIds: readonly string[];
};

export function renderFixture(options: {
  readonly repositoryRoot: string;
  readonly fixtureRoot: string;
  readonly outputRoot: string;
  readonly validatedFixture?: boolean;
  readonly onTemporaryOutput?: (temporary: string) => void;
}): Promise<RenderResult>;
