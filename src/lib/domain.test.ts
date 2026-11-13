import { describe, expect, it } from "vitest";
import { createTestData } from "../test/fixtures";
import type { ActiveTimer, TimeEntry } from "../types";
import {
  calculateTotals,
  completeActiveTimer,
  entriesOverlap,
  entriesToCsv,
  filterEntries,
  pauseActiveTimer,
  resumeActiveTimer,
  restMinutes,
  workMinutes,
} from "./domain";

const activeTimer = (): ActiveTimer => ({
  id: "timer",
  workspaceId: "w1",
  userId: "u1",
  description: "Overnight release",
  tagIds: [],
  startedAt: "2025-01-01T23:30:00.000Z",
  status: "running",
  segments: [{ id: "s1", type: "work", start: "2025-01-01T23:30:00.000Z" }],
});

describe("timer domain", () => {
  it("pauses and resumes while preserving work and break segments", () => {
    const paused = pauseActiveTimer(activeTimer(), "2025-01-02T00:00:00.000Z");
    const resumed = resumeActiveTimer(paused, "2025-01-02T00:10:00.000Z");
    expect(resumed.status).toBe("running");
    expect(resumed.segments.map((segment) => segment.type)).toEqual(["work", "break", "work"]);
    expect(workMinutes(resumed, Date.parse("2025-01-02T00:40:00.000Z"))).toBe(60);
    expect(restMinutes(resumed, Date.parse("2025-01-02T00:40:00.000Z"))).toBe(10);
  });

  it("supports multiple break intervals", () => {
    let timer = pauseActiveTimer(activeTimer(), "2025-01-02T00:00:00.000Z");
    timer = resumeActiveTimer(timer, "2025-01-02T00:05:00.000Z");
    timer = pauseActiveTimer(timer, "2025-01-02T00:20:00.000Z");
    timer = resumeActiveTimer(timer, "2025-01-02T00:30:00.000Z");
    const entry = completeActiveTimer(timer, "2025-01-02T00:45:00.000Z");
    expect(entry.segments.filter((segment) => segment.type === "break")).toHaveLength(2);
    expect(workMinutes(entry)).toBe(60);
    expect(restMinutes(entry)).toBe(15);
  });

  it("completes sessions that cross midnight", () => {
    const entry = completeActiveTimer(activeTimer(), "2025-01-02T01:00:00.000Z");
    expect(workMinutes(entry)).toBe(90);
    expect(new Date(entry.start).getUTCDate()).not.toBe(new Date(entry.end).getUTCDate());
  });
});

describe("entry and reporting rules", () => {
  const data = createTestData();

  it("detects overlaps but not adjacent entries", () => {
    const existing = { start: "2025-01-01T09:00:00Z", end: "2025-01-01T10:00:00Z" };
    expect(
      entriesOverlap({ start: "2025-01-01T09:30:00Z", end: "2025-01-01T10:30:00Z" }, existing),
    ).toBe(true);
    expect(
      entriesOverlap({ start: "2025-01-01T10:00:00Z", end: "2025-01-01T11:00:00Z" }, existing),
    ).toBe(false);
  });

  it("combines project, tag, member, and source filters", () => {
    const results = filterEntries(data.entries, {
      projectId: "p1",
      tagId: "g1",
      memberId: "u1",
      source: "timer",
    });
    expect(results.length).toBeGreaterThan(0);
    expect(results.every((entry) => entry.projectId === "p1" && entry.tagIds.includes("g1"))).toBe(
      true,
    );
  });

  it("sorts filtered entries and calculates dashboard totals from records", () => {
    const results = filterEntries(data.entries, { sort: "longest" });
    expect(workMinutes(results[0])).toBeGreaterThanOrEqual(workMinutes(results.at(-1)!));
    const totals = calculateTotals(results);
    expect(totals.tracked).toBe(results.reduce((sum, entry) => sum + workMinutes(entry), 0));
    expect(totals.sessions).toBe(results.length);
  });

  it("exports only supplied filtered rows with escaped values", () => {
    const filtered = filterEntries(data.entries, { projectId: "p2" });
    const rows = filtered.map((entry) => ({
      Description: entry.description,
      Project: entry.projectId || "",
    }));
    const csv = entriesToCsv(rows);
    expect(csv.split("\n")).toHaveLength(filtered.length + 1);
    expect(csv).not.toContain('"p1"');
  });

  it("supports immutable-style manual entry CRUD", () => {
    const original = data.entries;
    const created: TimeEntry = {
      ...original[0],
      id: "manual-test",
      description: "Manual test",
      source: "manual",
    };
    const afterCreate = [created, ...original];
    const afterEdit = afterCreate.map((entry) =>
      entry.id === created.id ? { ...entry, notes: "Updated" } : entry,
    );
    const afterDelete = afterEdit.filter((entry) => entry.id !== created.id);
    expect(afterCreate).toHaveLength(original.length + 1);
    expect(afterEdit.find((entry) => entry.id === created.id)?.notes).toBe("Updated");
    expect(afterDelete).toHaveLength(original.length);
    expect(original.find((entry) => entry.id === created.id)).toBeUndefined();
  });
});
