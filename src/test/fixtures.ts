import type { AppData } from "../types";

export function createTestData(): AppData {
  const start = "2025-03-01T09:00:00.000Z";
  const end = "2025-03-01T10:00:00.000Z";
  return {
    users: [
      {
        id: "u1",
        workspaceIds: ["w1", "w2"],
        name: "Test Admin",
        email: "admin@example.test",
        role: "admin",
        status: "active",
        joinedAt: start,
        avatar: "TA",
        timezone: "UTC",
        timeFormat: "12h",
      },
      {
        id: "u2",
        workspaceIds: ["w1"],
        name: "Test Member",
        email: "member@example.test",
        role: "member",
        status: "active",
        joinedAt: start,
        avatar: "TM",
        timezone: "UTC",
        timeFormat: "24h",
      },
    ],
    workspaces: [
      { id: "w1", name: "Test Workspace" },
      { id: "w2", name: "Second Test Workspace" },
    ],
    activeWorkspaceId: "w1",
    workspaceMemberships: [
      { workspaceId: "w1", userId: "u1", role: "admin", status: "active", createdAt: start },
      { workspaceId: "w2", userId: "u1", role: "admin", status: "active", createdAt: start },
      { workspaceId: "w1", userId: "u2", role: "member", status: "active", createdAt: start },
    ],
    projects: [
      {
        id: "p1",
        workspaceId: "w1",
        name: "Test Project",
        client: "",
        description: "",
        color: "#4f6ef7",
        status: "active",
        createdAt: start,
      },
    ],
    tasks: [],
    tags: [{ id: "g1", workspaceId: "w1", name: "Test Tag", color: "#6366f1" }],
    entries: [
      {
        id: "e1",
        workspaceId: "w1",
        userId: "u1",
        description: "Test entry",
        projectId: "p1",
        tagIds: ["g1"],
        start,
        end,
        source: "timer",
        segments: [{ id: "s1", type: "work", start, end }],
      },
    ],
    audit: [],
  };
}
