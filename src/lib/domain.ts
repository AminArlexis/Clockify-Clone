import type { ActiveTimer, Segment, TimeEntry } from "../types";

export interface EntryFilters {
  from?: string;
  to?: string;
  projectId?: string;
  taskId?: string;
  tagId?: string;
  memberId?: string;
  source?: TimeEntry["source"] | "";
  sort?: "newest" | "oldest" | "longest" | "shortest";
  search?: string;
}

const segmentId = () => `segment-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

export const minutesBetween = (start: string, end?: string, now = Date.now()) =>
  Math.max(
    0,
    Math.round(((end ? new Date(end).getTime() : now) - new Date(start).getTime()) / 60000),
  );

export const workMinutes = (entry: Pick<TimeEntry, "segments">, now = Date.now()) =>
  entry.segments
    .filter((segment) => segment.type === "work")
    .reduce((sum, segment) => sum + minutesBetween(segment.start, segment.end, now), 0);

export const restMinutes = (entry: Pick<TimeEntry, "segments">, now = Date.now()) =>
  entry.segments
    .filter((segment) => segment.type === "break")
    .reduce((sum, segment) => sum + minutesBetween(segment.start, segment.end, now), 0);

const safeZone = (timezone?: string) => {
  if (!timezone) return undefined;
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return timezone;
  } catch {
    return undefined;
  }
};

const dayBoundsMs = (dayKey: string, timezone?: string): [number, number] => {
  const [y, m, d] = dayKey.split("-").map(Number);
  const tz = safeZone(timezone);
  if (!tz) {
    const start = new Date(y, m - 1, d, 0, 0, 0, 0).getTime();
    const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0).getTime();
    return [start, end];
  }
  const toUtcAtZonedMidnight = (year: number, month: number, day: number) => {
    const utcGuess = Date.UTC(year, month - 1, day, 0, 0, 0);
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
    return utcGuess - (zonedAsUtc - utcGuess);
  };
  return [toUtcAtZonedMidnight(y, m, d), toUtcAtZonedMidnight(y, m, d + 1)];
};

export function workMinutesForDay(
  entry: Pick<TimeEntry, "start" | "end" | "segments">,
  dayKey: string,
  timezone?: string,
  now = Date.now(),
) {
  const [dayStart, dayEnd] = dayBoundsMs(dayKey, timezone);
  const segments = entry.segments.length
    ? entry.segments.filter((segment) => segment.type === "work")
    : [{ id: "fallback", type: "work" as const, start: entry.start, end: entry.end }];
  const totalMs = segments.reduce((sum, segment) => {
    const segStart = new Date(segment.start).getTime();
    const segEnd = segment.end ? new Date(segment.end).getTime() : now;
    const overlapStart = Math.max(segStart, dayStart);
    const overlapEnd = Math.min(segEnd, dayEnd);
    return overlapEnd > overlapStart ? sum + (overlapEnd - overlapStart) : sum;
  }, 0);
  return Math.max(0, Math.round(totalMs / 60000));
}

export function entryTouchesDay(
  entry: Pick<TimeEntry, "start" | "end" | "segments">,
  dayKey: string,
  timezone?: string,
  now = Date.now(),
) {
  const [dayStart, dayEnd] = dayBoundsMs(dayKey, timezone);
  const startMs = new Date(entry.start).getTime();
  const endMs = entry.end ? new Date(entry.end).getTime() : now;
  if (endMs <= startMs) {
    return startMs >= dayStart && startMs < dayEnd;
  }
  return workMinutesForDay(entry, dayKey, timezone, now) > 0;
}

export function dayIntervalForEntry(
  entry: Pick<TimeEntry, "start" | "end">,
  dayKey: string,
  timezone?: string,
  now = Date.now(),
) {
  const [dayStart, dayEnd] = dayBoundsMs(dayKey, timezone);
  const startMs = Math.max(new Date(entry.start).getTime(), dayStart);
  const endMs = Math.min(entry.end ? new Date(entry.end).getTime() : now, dayEnd);
  return {
    start: new Date(startMs).toISOString(),
    end: new Date(Math.max(startMs, endMs)).toISOString(),
  };
}

export function closeOpenSegment(segments: Segment[], at: string) {
  return segments.map((segment, index) =>
    index === segments.length - 1 && !segment.end ? { ...segment, end: at } : segment,
  );
}

export function pauseActiveTimer(timer: ActiveTimer, at = new Date().toISOString()): ActiveTimer {
  if (timer.status !== "running") throw new Error("Timer is already paused.");
  return {
    ...timer,
    status: "paused",
    segments: [
      ...closeOpenSegment(timer.segments, at),
      { id: segmentId(), type: "break", start: at },
    ],
  };
}

export function resumeActiveTimer(timer: ActiveTimer, at = new Date().toISOString()): ActiveTimer {
  if (timer.status !== "paused") throw new Error("Timer is already running.");
  return {
    ...timer,
    status: "running",
    segments: [
      ...closeOpenSegment(timer.segments, at),
      { id: segmentId(), type: "work", start: at },
    ],
  };
}

export function completeActiveTimer(timer: ActiveTimer, at = new Date().toISOString()): TimeEntry {
  return {
    id: timer.id,
    workspaceId: timer.workspaceId,
    userId: timer.userId,
    description: timer.description || "Untitled activity",
    projectId: timer.projectId,
    taskId: timer.taskId,
    tagIds: timer.tagIds,
    start: timer.startedAt,
    end: at,
    source: "timer",
    segments: closeOpenSegment(timer.segments, at),
  };
}

export function entriesOverlap(
  candidate: Pick<TimeEntry, "start" | "end">,
  existing: Pick<TimeEntry, "start" | "end">,
) {
  return (
    new Date(existing.start) < new Date(candidate.end) &&
    new Date(existing.end) > new Date(candidate.start)
  );
}

export function filterEntries(entries: TimeEntry[], filters: EntryFilters) {
  const from = filters.from ? new Date(`${filters.from}T00:00:00`).getTime() : -Infinity;
  const to = filters.to ? new Date(`${filters.to}T23:59:59.999`).getTime() : Infinity;
  const search = filters.search?.trim().toLowerCase();
  const result = entries.filter((entry) => {
    const started = new Date(entry.start).getTime();
    return (
      started >= from &&
      started <= to &&
      (!filters.projectId || entry.projectId === filters.projectId) &&
      (!filters.taskId || entry.taskId === filters.taskId) &&
      (!filters.tagId || entry.tagIds.includes(filters.tagId)) &&
      (!filters.memberId || entry.userId === filters.memberId) &&
      (!filters.source || entry.source === filters.source) &&
      (!search || `${entry.description} ${entry.notes || ""}`.toLowerCase().includes(search))
    );
  });
  return result.sort((a, b) => {
    if (filters.sort === "oldest") return +new Date(a.start) - +new Date(b.start);
    if (filters.sort === "longest") return workMinutes(b) - workMinutes(a);
    if (filters.sort === "shortest") return workMinutes(a) - workMinutes(b);
    return +new Date(b.start) - +new Date(a.start);
  });
}

export function calculateTotals(entries: TimeEntry[]) {
  return {
    tracked: entries.reduce((sum, entry) => sum + workMinutes(entry), 0),
    breaks: entries.reduce((sum, entry) => sum + restMinutes(entry), 0),
    sessions: entries.length,
  };
}

export function entriesToCsv(rows: Array<Record<string, string>>) {
  if (!rows.length) return "";
  return [Object.keys(rows[0]), ...rows.map(Object.values)]
    .map((row) => row.map((value) => `"${String(value).replace(/"/g, '""')}"`).join(","))
    .join("\n");
}
