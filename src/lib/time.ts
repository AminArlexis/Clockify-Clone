import type { User } from "../types";

export const safeTimeZone = (timezone?: string) => {
  if (!timezone) return undefined;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch {
    return undefined;
  }
};

export const dateKey = (date: Date | string, timezone?: string) => {
  const d = new Date(date);
  const tz = safeTimeZone(timezone);
  if (tz) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(d);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export const fmtClock = (
  iso: string | Date,
  timezone?: string,
  timeFormat?: User["timeFormat"],
) => {
  const tz = safeTimeZone(timezone);
  return new Date(iso).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
    hour12: timeFormat ? timeFormat !== "24h" : undefined,
    ...(tz ? { timeZone: tz } : {}),
  });
};

export const zonedDateTimeToDate = (day: string, time: string, timezone?: string) => {
  const tz = safeTimeZone(timezone);
  if (!tz) return new Date(`${day}T${time}`);
  const [y, m, d] = day.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const utcGuess = Date.UTC(y, m - 1, d, hh, mm, 0);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).formatToParts(new Date(utcGuess));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value || 0);
  const zonedAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour") === 24 ? 0 : get("hour"),
    get("minute"),
    get("second"),
  );
  return new Date(utcGuess - (zonedAsUtc - utcGuess));
};