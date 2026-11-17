import { describe, expect, it } from "vitest";
import { dateKey, fmtClock, zonedDateTimeToDate, safeTimeZone } from "./time";

describe("timezone", () => {
  it("ignores invalid timezones", () => {
    expect(safeTimeZone("Not/AZone")).toBeUndefined();
    expect(safeTimeZone("Asia/Manila")).toBe("Asia/Manila");
  });

  it("converts Manila local time to the correct UTC instant", () => {
    // 09:00 sa Manila (UTC+8) = 01:00 UTC
    const d = zonedDateTimeToDate("2026-11-17", "09:00", "Asia/Manila");
    expect(d.toISOString()).toBe("2026-11-17T01:00:00.000Z");
  });

  it("converts New York local time (UTC-5 in November)", () => {
    const d = zonedDateTimeToDate("2026-11-17", "09:00", "America/New_York");
    expect(d.toISOString()).toBe("2026-11-17T14:00:00.000Z");
  });

  it("dateKey uses the given timezone, not the machine's", () => {
    const iso = "2026-11-17T20:00:00.000Z"; // 4:00 AM Nov 18 sa Manila
    expect(dateKey(iso, "Asia/Manila")).toBe("2026-11-18");
    expect(dateKey(iso, "America/New_York")).toBe("2026-11-17");
  });

  it("fmtClock respects 24h and 12h formats", () => {
    const iso = "2026-11-17T01:00:00.000Z";
    expect(fmtClock(iso, "Asia/Manila", "24h")).toMatch(/09:00/);
    expect(fmtClock(iso, "Asia/Manila", "12h")).toMatch(/9:00/);
  });

  it("round-trips: input time -> UTC -> displayed time", () => {
    const d = zonedDateTimeToDate("2026-11-17", "23:30", "Asia/Manila");
    expect(dateKey(d, "Asia/Manila")).toBe("2026-11-17");
  });
});