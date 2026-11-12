export type Role = "admin" | "member";
export type Page =
  | "dashboard"
  | "tracker"
  | "calendar"
  | "timesheet"
  | "projects"
  | "tags"
  | "reports"
  | "team"
  | "audit"
  | "settings";

export interface User {
  id: string;
  workspaceIds: string[];
  name: string;
  email: string;
  role: Role;
  status: "active" | "invited" | "inactive";
  joinedAt: string;
  avatar: string;
  timezone: string;
  timeFormat: "12h" | "24h";
}

export interface Workspace {
  id: string;
  name: string;
}

export interface Project {
  id: string;
  workspaceId: string;
  name: string;
  client: string;
  description: string;
  color: string;
  status: "active" | "archived";
  createdAt: string;
}

export interface Task {
  id: string;
  workspaceId: string;
  projectId: string;
  name: string;
  assigneeId?: string;
  completed: boolean;
}

export interface Tag {
  id: string;
  workspaceId: string;
  name: string;
  color: string;
  archived?: boolean;
}

export interface Segment {
  id: string;
  type: "work" | "break";
  start: string;
  end?: string;
}

export interface TimeEntry {
  id: string;
  workspaceId: string;
  userId: string;
  description: string;
  projectId?: string;
  taskId?: string;
  tagIds: string[];
  start: string;
  end: string;
  source: "timer" | "manual";
  segments: Segment[];
  notes?: string;
}

export interface ActiveTimer {
  id: string;
  workspaceId: string;
  userId: string;
  description: string;
  projectId?: string;
  taskId?: string;
  tagIds: string[];
  startedAt: string;
  status: "running" | "paused";
  segments: Segment[];
}

export interface AuditEvent {
  id: string;
  workspaceId: string;
  actorId: string;
  action: string;
  target: string;
  detail: string;
  reason?: string;
  previousValue?: string;
  updatedValue?: string;
  createdAt: string;
}

export interface AppData {
  users: User[];
  workspaces: Workspace[];
  activeWorkspaceId: string;
  projects: Project[];
  tasks: Task[];
  tags: Tag[];
  entries: TimeEntry[];
  activeTimer?: ActiveTimer;
  audit: AuditEvent[];
}

export type EntryInput = Omit<TimeEntry, "id" | "workspaceId" | "segments" | "source"> & {
  id?: string;
  workspaceId?: string;
  source?: TimeEntry["source"];
  segments?: Segment[];
};
