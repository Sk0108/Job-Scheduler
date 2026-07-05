import parser from "cron-parser";

/** Returns the next Date a cron expression fires after `from` (default now), in the given timezone. */
export function getNextCronRun(cronExpression: string, timezone = "UTC", from: Date = new Date()): Date {
  const interval = parser.parseExpression(cronExpression, {
    currentDate: from,
    tz: timezone,
  });
  return interval.next().toDate();
}

export function isValidCronExpression(cronExpression: string): boolean {
  try {
    parser.parseExpression(cronExpression);
    return true;
  } catch {
    return false;
  }
}
