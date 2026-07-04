export function areDurableSchedulerWritesEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.PULSE_DURABLE_SCHEDULER_WRITES?.trim().toLowerCase() === "true";
}
