type InterruptSignal = "SIGINT" | "SIGTERM";

export const ownInterruptCleanup = (
  cleanup: () => Promise<void>
): (() => Promise<void>) => {
  let cleanupPromise: Promise<void> | undefined;
  const clean = (): Promise<void> => {
    cleanupPromise ??= cleanup();
    return cleanupPromise;
  };
  const detach = (): void => {
    process.off("SIGINT", onSigint);
    process.off("SIGTERM", onSigterm);
  };
  const repeat = (signal: InterruptSignal): void => {
    detach();
    const terminate = (): void => process.kill(process.pid, signal);
    void clean().then(terminate, terminate);
  };
  const onSigint = (): void => repeat("SIGINT");
  const onSigterm = (): void => repeat("SIGTERM");
  process.once("SIGINT", onSigint);
  process.once("SIGTERM", onSigterm);
  return async (): Promise<void> => {
    detach();
    await clean();
  };
};
