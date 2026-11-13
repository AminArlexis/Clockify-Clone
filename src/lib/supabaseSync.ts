import { supabase, isSupabaseConfigured } from "./supabase";
import type {
  AppData,
  Project,
  Task,
  Tag,
  TimeEntry,
  ActiveTimer,
  AuditEvent,
  User,
  Workspace,
  WorkspaceMembership,
} from "../types";

export async function fetchAppDataFromSupabase(userId: string): Promise<AppData | null> {
  const client = supabase;
  if (!isSupabaseConfigured || !client || !userId) return null;

  const { data: ownMemberships, error: ownMembershipsError } = await client
    .from("workspace_members")
    .select("workspace_id, user_id, role, status, created_at")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (ownMembershipsError) throw ownMembershipsError;
  if (!ownMemberships?.length) return null;

  const workspaceIds = [...new Set(ownMemberships.map((membership) => membership.workspace_id))];
  const [workspacesRes, membershipsRes] = await Promise.all([
    client.from("workspaces").select("*").in("id", workspaceIds),
    client
      .from("workspace_members")
      .select("workspace_id, user_id, role, status, created_at")
      .in("workspace_id", workspaceIds),
  ]);
  if (workspacesRes.error) throw workspacesRes.error;
  if (membershipsRes.error) throw membershipsRes.error;

  const memberIds = [
    ...new Set([userId, ...(membershipsRes.data || []).map((membership) => membership.user_id)]),
  ];
  const [
    profilesRes,
    projectsRes,
    tasksRes,
    tagsRes,
    entriesRes,
    timerRes,
    auditRes,
  ] = await Promise.all([
    client.from("profiles").select("*").in(
      "id",
      memberIds,
    ),
    client.from("projects").select("*").in("workspace_id", workspaceIds),
    client.from("tasks").select("*").in("workspace_id", workspaceIds),
    client.from("tags").select("*").in("workspace_id", workspaceIds),
    client
      .from("time_entries")
      .select("*")
      .in("workspace_id", workspaceIds)
      .order("start_time", { ascending: false }),
    client
      .from("active_timers")
      .select("*")
      .in("workspace_id", workspaceIds)
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    client
      .from("audit_events")
      .select("*")
      .in("workspace_id", workspaceIds)
      .order("created_at", { ascending: false })
      .limit(100),
  ]);

  const error = [
    profilesRes.error,
    projectsRes.error,
    tasksRes.error,
    tagsRes.error,
    entriesRes.error,
    timerRes.error,
    auditRes.error,
  ].find(Boolean);
  if (error) throw error;

  const workspaces: Workspace[] = (workspacesRes.data || []).map((w: any) => ({
    id: w.id,
    name: w.name,
  }));
  const workspaceMemberships: WorkspaceMembership[] = (membershipsRes.data || []).map(
    (membership: any) => ({
      workspaceId: membership.workspace_id,
      userId: membership.user_id,
      role: membership.role === "admin" ? "admin" : "member",
      status: membership.status === "inactive" ? "inactive" : "active",
      createdAt: membership.created_at,
    }),
  );
  const activeWorkspaceId = ownMemberships[0].workspace_id;
  const users: User[] = (profilesRes.data || []).map((profile: any) => {
    const memberships = workspaceMemberships.filter(
      (membership) => membership.userId === profile.id,
    );
    const membership =
      memberships.find((candidate) => candidate.workspaceId === activeWorkspaceId) ||
      memberships[0];
    return {
      id: profile.id,
      workspaceIds: memberships.map((candidate) => candidate.workspaceId),
      name: profile.name,
      email: profile.email,
      role: membership?.role || "member",
      status: membership?.status || "inactive",
      joinedAt: profile.joined_at,
      avatar: profile.avatar || "",
      timezone: profile.timezone || "UTC",
      timeFormat: profile.time_format === "24h" ? "24h" : "12h",
    };
  });

  const projects: Project[] = (projectsRes.data || []).map((p: any) => ({
    id: p.id,
    workspaceId: p.workspace_id,
    name: p.name,
    client: p.client || "",
    description: p.description || "",
    color: p.color || "#3b82f6",
    status: p.status || "active",
    createdAt: p.created_at,
  }));

  const tasks: Task[] = (tasksRes.data || []).map((t: any) => ({
    id: t.id,
    workspaceId: t.workspace_id,
    projectId: t.project_id,
    name: t.name,
    assigneeId: t.assignee_id || undefined,
    completed: Boolean(t.completed),
  }));

  const tags: Tag[] = (tagsRes.data || []).map((t: any) => ({
    id: t.id,
    workspaceId: t.workspace_id,
    name: t.name,
    color: t.color || "#6b7280",
    archived: Boolean(t.archived),
  }));

  const entries: TimeEntry[] = (entriesRes.data || []).map((e: any) => ({
    id: e.id,
    workspaceId: e.workspace_id,
    userId: e.user_id,
    description: e.description || "",
    projectId: e.project_id || undefined,
    taskId: e.task_id || undefined,
    tagIds: e.tag_ids || [],
    start: e.start_time,
    end: e.end_time,
    source: e.source || "timer",
    segments: Array.isArray(e.segments) ? e.segments : [],
    notes: e.notes || undefined,
  }));

  const timer = timerRes.data;
  const activeTimer: ActiveTimer | undefined = timer
    ? {
        id: timer.id,
        workspaceId: timer.workspace_id,
        userId: timer.user_id,
        description: timer.description || "",
        projectId: timer.project_id || undefined,
        taskId: timer.task_id || undefined,
        tagIds: timer.tag_ids || [],
        startedAt: timer.started_at,
        status: timer.status || "running",
        segments: Array.isArray(timer.segments) ? timer.segments : [],
      }
    : undefined;

  const audit: AuditEvent[] = (auditRes.data || []).map((a: any) => ({
    id: a.id,
    workspaceId: a.workspace_id,
    actorId: a.actor_id,
    action: a.action,
    target: a.target,
    detail: a.detail,
    reason: a.reason || undefined,
    previousValue: a.previous_value || undefined,
    updatedValue: a.updated_value || undefined,
    createdAt: a.created_at,
  }));

  return {
    users,
    workspaces,
    activeWorkspaceId,
    workspaceMemberships,
    projects,
    tasks,
    tags,
    entries,
    activeTimer,
    audit,
  };
}

export async function registerWorkspaceAccount(user: User, workspace: Workspace) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.rpc("register_workspace_account", {
    p_workspace_id: workspace.id,
    p_workspace_name: workspace.name,
    p_full_name: user.name,
    p_avatar: user.avatar,
    p_timezone: user.timezone,
    p_time_format: user.timeFormat,
  });
  if (error) throw error;
}

export async function claimWorkspaceInvitesInSupabase() {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.rpc("claim_workspace_invites");
  if (error) throw error;
}

export async function updateWorkspaceMemberInSupabase(
  workspaceId: string,
  user: Pick<User, "id" | "role"> & { status: "active" | "inactive" },
) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.rpc("update_workspace_member", {
    p_workspace_id: workspaceId,
    p_user_id: user.id,
    p_role: user.role,
    p_status: user.status,
  });
  if (error) throw error;
}

export async function updateMyProfileInSupabase(user: User) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.rpc("update_my_profile", {
    p_full_name: user.name,
    p_avatar: user.avatar,
    p_timezone: user.timezone,
    p_time_format: user.timeFormat,
  });
  if (error) throw error;
}

export async function inviteWorkspaceMemberInSupabase(
  workspaceId: string,
  email: string,
  role: User["role"],
) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.rpc("invite_workspace_member", {
    p_workspace_id: workspaceId,
    p_email: email,
    p_role: role,
  });
  if (error) throw error;
}

export async function syncEntryToSupabase(entry: TimeEntry) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.from("time_entries").upsert({
    id: entry.id,
    workspace_id: entry.workspaceId,
    user_id: entry.userId,
    description: entry.description,
    project_id: entry.projectId || null,
    task_id: entry.taskId || null,
    tag_ids: entry.tagIds,
    start_time: entry.start,
    end_time: entry.end,
    source: entry.source,
    segments: entry.segments,
    notes: entry.notes || null,
  });
  if (error) throw error;
}

export async function deleteEntryFromSupabase(id: string) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.from("time_entries").delete().eq("id", id);
  if (error) throw error;
}

export async function syncProjectToSupabase(project: Project) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.from("projects").upsert({
    id: project.id,
    workspace_id: project.workspaceId,
    name: project.name,
    client: project.client,
    description: project.description,
    color: project.color,
    status: project.status,
    created_at: project.createdAt,
  });
  if (error) throw error;
}

export async function syncTaskToSupabase(task: Task) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.from("tasks").upsert({
    id: task.id,
    workspace_id: task.workspaceId,
    project_id: task.projectId,
    name: task.name,
    assignee_id: task.assigneeId || null,
    completed: task.completed,
  });
  if (error) throw error;
}

export async function syncTagToSupabase(tag: Tag) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.from("tags").upsert({
    id: tag.id,
    workspace_id: tag.workspaceId,
    name: tag.name,
    color: tag.color,
    archived: tag.archived || false,
  });
  if (error) throw error;
}

export async function deleteTagFromSupabase(id: string) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.from("tags").delete().eq("id", id);
  if (error) throw error;
}

export async function syncActiveTimerToSupabase(timer?: ActiveTimer, userId?: string) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  if (!timer) {
    if (!userId) throw new Error("A user ID is required to clear an active timer.");
    const { error } = await client.from("active_timers").delete().eq("user_id", userId);
    if (error) throw error;
    return;
  }
  const { error } = await client.from("active_timers").upsert(
    {
      id: timer.id,
      workspace_id: timer.workspaceId,
      user_id: timer.userId,
      description: timer.description,
      project_id: timer.projectId || null,
      task_id: timer.taskId || null,
      tag_ids: timer.tagIds,
      started_at: timer.startedAt,
      status: timer.status,
      segments: timer.segments,
    },
    { onConflict: "user_id" },
  );
  if (error) throw error;
}

export async function syncAuditEventToSupabase(event: AuditEvent) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.from("audit_events").insert({
    id: event.id,
    workspace_id: event.workspaceId,
    actor_id: event.actorId,
    action: event.action,
    target: event.target,
    detail: event.detail,
    reason: event.reason || null,
    previous_value: event.previousValue || null,
    updated_value: event.updatedValue || null,
    created_at: event.createdAt,
  });
  if (error) throw error;
}

export async function deleteProjectFromSupabase(id: string) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.from("projects").delete().eq("id", id);
  if (error) throw error;
}

export async function deleteTaskFromSupabase(id: string) {
  const client = supabase;
  if (!client) throw new Error("Supabase is not configured.");
  const { error } = await client.from("tasks").delete().eq("id", id);
  if (error) throw error;
}
