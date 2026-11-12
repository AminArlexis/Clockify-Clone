import type { AppData, Segment, TimeEntry } from "../types";

const isoAt = (daysAgo: number, hour: number, minute = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
};

const entry = (
  id: string,
  daysAgo: number,
  startHour: number,
  durationMinutes: number,
  description: string,
  projectId: string,
  userId: string,
  taskId: string,
  tagIds: string[],
  breakMinutes = 0,
): TimeEntry => {
  const start = isoAt(daysAgo, startHour);
  const workOneEnd = new Date(
    new Date(start).getTime() + Math.max(30, durationMinutes / 2) * 60000,
  ).toISOString();
  const breakEnd = new Date(new Date(workOneEnd).getTime() + breakMinutes * 60000).toISOString();
  const end = new Date(
    new Date(start).getTime() + (durationMinutes + breakMinutes) * 60000,
  ).toISOString();
  const segments: Segment[] = breakMinutes
    ? [
        { id: `${id}-1`, type: "work", start, end: workOneEnd },
        { id: `${id}-2`, type: "break", start: workOneEnd, end: breakEnd },
        { id: `${id}-3`, type: "work", start: breakEnd, end },
      ]
    : [{ id: `${id}-1`, type: "work", start, end }];
  return {
    id,
    workspaceId: "w1",
    userId,
    description,
    projectId,
    taskId,
    tagIds,
    start,
    end,
    source: "timer",
    segments,
  };
};

export function createMockData(): AppData {
  return {
    users: [
      {
        id: "u1",
        workspaceIds: ["w1", "w2"],
        name: "Olivia Martin",
        email: "olivia@timeflow.demo",
        role: "admin",
        status: "active",
        joinedAt: isoAt(150, 9),
        avatar: "OM",
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        timeFormat: "12h",
      },
      {
        id: "u2",
        workspaceIds: ["w1"],
        name: "Ethan Brooks",
        email: "ethan@timeflow.demo",
        role: "member",
        status: "active",
        joinedAt: isoAt(112, 9),
        avatar: "EB",
        timezone: "America/New_York",
        timeFormat: "12h",
      },
      {
        id: "u3",
        workspaceIds: ["w1"],
        name: "Maya Chen",
        email: "maya@timeflow.demo",
        role: "member",
        status: "active",
        joinedAt: isoAt(73, 9),
        avatar: "MC",
        timezone: "Europe/London",
        timeFormat: "24h",
      },
      {
        id: "u4",
        workspaceIds: ["w1"],
        name: "Noah Williams",
        email: "noah@example.com",
        role: "member",
        status: "invited",
        joinedAt: isoAt(2, 9),
        avatar: "NW",
        timezone: "America/Chicago",
        timeFormat: "12h",
      },
    ],
    workspaces: [
      { id: "w1", name: "Northstar Studio" },
      { id: "w2", name: "Personal Workspace" },
    ],
    activeWorkspaceId: "w1",
    projects: [
      {
        id: "p1",
        workspaceId: "w1",
        name: "Website Redesign",
        client: "Acme Co.",
        description: "Research, design, and build the new marketing site.",
        color: "#4f6ef7",
        status: "active",
        createdAt: isoAt(90, 9),
      },
      {
        id: "p2",
        workspaceId: "w1",
        name: "Mobile App",
        client: "Vela Health",
        description: "Product design and feature delivery for the patient app.",
        color: "#8b5cf6",
        status: "active",
        createdAt: isoAt(62, 9),
      },
      {
        id: "p3",
        workspaceId: "w1",
        name: "Internal Operations",
        client: "Northstar",
        description: "Planning, hiring, and internal process improvements.",
        color: "#14b8a6",
        status: "active",
        createdAt: isoAt(160, 9),
      },
      {
        id: "p4",
        workspaceId: "w1",
        name: "Brand Sprint",
        client: "Orbital Labs",
        description: "Completed visual identity sprint.",
        color: "#f59e0b",
        status: "archived",
        createdAt: isoAt(200, 9),
      },
    ],
    tasks: [
      {
        id: "t1",
        workspaceId: "w1",
        projectId: "p1",
        name: "Design system",
        assigneeId: "u1",
        completed: false,
      },
      {
        id: "t2",
        workspaceId: "w1",
        projectId: "p1",
        name: "Landing page",
        assigneeId: "u2",
        completed: false,
      },
      {
        id: "t3",
        workspaceId: "w1",
        projectId: "p2",
        name: "Prototype testing",
        assigneeId: "u1",
        completed: false,
      },
      {
        id: "t4",
        workspaceId: "w1",
        projectId: "p2",
        name: "Onboarding flow",
        assigneeId: "u3",
        completed: true,
      },
      {
        id: "t5",
        workspaceId: "w1",
        projectId: "p3",
        name: "Weekly planning",
        assigneeId: "u1",
        completed: false,
      },
    ],
    tags: [
      { id: "g1", workspaceId: "w1", name: "Design", color: "#6366f1" },
      { id: "g2", workspaceId: "w1", name: "Research", color: "#0ea5e9" },
      { id: "g3", workspaceId: "w1", name: "Meeting", color: "#f59e0b" },
      { id: "g4", workspaceId: "w1", name: "Deep work", color: "#10b981" },
    ],
    entries: [
      entry("e1", 0, 9, 135, "Design dashboard components", "p1", "u1", "t1", ["g1", "g4"], 15),
      entry("e2", 0, 13, 65, "User interview synthesis", "p2", "u1", "t3", ["g2"]),
      entry("e3", 1, 10, 180, "Landing page implementation", "p1", "u2", "t2", ["g4"], 20),
      entry("e4", 1, 14, 80, "Sprint planning", "p3", "u1", "t5", ["g3"]),
      entry("e5", 2, 9, 210, "Onboarding flow refinements", "p2", "u3", "t4", ["g1"], 25),
      entry("e6", 2, 13, 155, "Component documentation", "p1", "u1", "t1", ["g1", "g4"]),
      entry("e7", 3, 11, 95, "Roadmap workshop", "p3", "u1", "t5", ["g3"]),
      entry("e8", 4, 9, 240, "Responsive page layouts", "p1", "u2", "t2", ["g4"], 30),
      entry("e9", 5, 10, 125, "Usability review", "p2", "u1", "t3", ["g2"]),
      entry("e10", 6, 8, 190, "Design tokens audit", "p1", "u1", "t1", ["g1"]),
    ],
    audit: [
      {
        id: "a1",
        workspaceId: "w1",
        actorId: "u1",
        action: "Updated project",
        target: "Website Redesign",
        detail: "Changed project description",
        createdAt: isoAt(0, 8),
      },
      {
        id: "a2",
        workspaceId: "w1",
        actorId: "u2",
        action: "Created time entry",
        target: "Landing page implementation",
        detail: "Added 3h 00m",
        createdAt: isoAt(1, 13),
      },
      {
        id: "a3",
        workspaceId: "w1",
        actorId: "u1",
        action: "Invited member",
        target: "Noah Williams",
        detail: "Invited as member",
        createdAt: isoAt(2, 11),
      },
    ],
  };
}
