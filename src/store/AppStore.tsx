import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { completeActiveTimer, pauseActiveTimer, resumeActiveTimer } from "../lib/domain";
import { isSupabaseConfigured, supabase } from "../lib/supabase";
import {
  fetchAppDataFromSupabase,
  registerWorkspaceAccount,
  updateWorkspaceMemberInSupabase,
  updateWorkspaceNameInSupabase,
  updateMyProfileInSupabase,
  inviteWorkspaceMemberInSupabase,
  syncEntryToSupabase,
  deleteEntryFromSupabase,
  syncProjectToSupabase,
  syncTaskToSupabase,
  syncTagToSupabase,
  deleteTagFromSupabase,
  syncActiveTimerToSupabase,
  syncAuditEventToSupabase,
} from "../lib/supabaseSync";
import type {
  ActiveTimer,
  AppData,
  AuditEvent,
  EntryInput,
  Project,
  Tag,
  Task,
  TimeEntry,
  User,
} from "../types";

const LEGACY_DATA_KEY = "timeflow-prototype-data-v2";
const LEGACY_SESSION_KEY = "timeflow-prototype-session";
const LEGACY_SESSION_EXPIRY_KEY = "timeflow-prototype-session-expiry";
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
const emptyData: AppData = {
  users: [],
  workspaces: [],
  activeWorkspaceId: "",
  workspaceMemberships: [],
  projects: [],
  tasks: [],
  tags: [],
  entries: [],
  audit: [],
};

interface AppStoreValue {
  data: AppData;
  currentUser?: User;
  loading: boolean;
  dataError: string;
  timerError: string;
  timerBusy: boolean;
  login: (email: string, userOverride?: User, remoteData?: AppData) => boolean;
  register: (name: string, email: string, customId?: string) => Promise<User>;
  logout: () => Promise<void>;
  switchWorkspace: (id: string) => void;
  startTimer: (input: Pick<ActiveTimer, "description" | "projectId" | "taskId" | "tagIds">) => void;
  pauseTimer: () => void;
  resumeTimer: () => void;
  stopTimer: () => void;
  retryTimerAction: () => void;
  clearTimerError: () => void;
  saveEntry: (entry: EntryInput, correctionReason?: string) => void;
  deleteEntry: (id: string) => void;
  saveProject: (
    project: Omit<Project, "createdAt" | "workspaceId"> & {
      createdAt?: string;
      workspaceId?: string;
    },
  ) => void;
  archiveProject: (id: string) => void;
  saveTask: (task: Task) => void;
  saveTag: (tag: Tag) => void;
  deleteTag: (id: string) => void;
  saveUser: (user: User) => void;
  inviteMember: (email: string, role: User["role"]) => Promise<void>;
  updateProfile: (patch: Partial<User>) => void;
  updateWorkspaceName: (name: string) => Promise<void>;
  addAudit: (action: string, target: string, detail: string) => void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

export function AppStoreProvider({
  children,
  initialData,
  initialSessionId,
}: {
  children: ReactNode;
  initialData?: AppData;
  initialSessionId?: string;
}) {
  const [data, setData] = useState<AppData>(initialData || emptyData);
  const [sessionId, setSessionId] = useState(initialSessionId || "");
  const [loading, setLoading] = useState(
    !initialData && isSupabaseConfigured && Boolean(supabase),
  );
  const [dataError, setDataError] = useState("");
  const [timerError, setTimerError] = useState("");
  const [timerBusy, setTimerBusy] = useState(false);
  const timerLock = useRef(false);
  const lastTimerAction = useRef<"pause" | "resume" | "stop" | null>(null);
  const currentUser = useMemo(() => {
  const base = data.users.find((user) => user.id === sessionId);
  if (!base) return undefined;
  const membership = data.workspaceMemberships?.find(
    (m) => m.userId === base.id && m.workspaceId === data.activeWorkspaceId,
  );
  // Kung walang membership sa active workspace, huwag bigyan ng admin
  return membership
    ? { ...base, role: membership.role, status: membership.status }
    : { ...base, role: "member" as const };
}, [data.users, data.workspaceMemberships, data.activeWorkspaceId, sessionId]);

  useEffect(() => {
    localStorage.removeItem(LEGACY_DATA_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_EXPIRY_KEY);
  }, []);

  useEffect(() => {
    if (initialData || initialSessionId || !supabase) {
      if (initialData) setLoading(false);
      return;
    }
    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data: sessionData, error }) => {
        if (!active) return;
        if (error) {
          setDataError(`Could not restore Supabase session: ${error.message}`);
          setLoading(false);
          return;
        }
        const nextSessionId = sessionData.session?.user.id || "";
        setSessionId(nextSessionId);
        if (!nextSessionId) setLoading(false);
      })
      .catch((error: unknown) => {
        if (active) {
          const message = error instanceof Error ? error.message : "Unknown Supabase error";
          setDataError(`Could not restore Supabase session: ${message}`);
          setLoading(false);
        }
      });

    let authSubscription: { unsubscribe: () => void } | undefined;
    if (typeof supabase.auth.onAuthStateChange === "function") {
      const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
        if (!active) return;
        const nextSessionId = session?.user.id || "";
        setSessionId(nextSessionId);
        if (!nextSessionId) setLoading(false);
      });
      authSubscription = authListener?.subscription;
    }

    return () => {
      active = false;
      authSubscription?.unsubscribe();
    };
  }, [initialData, initialSessionId]);

  useEffect(() => {
    if (initialData) {
      setLoading(false);
      return;
    }
    if (!isSupabaseConfigured || !supabase || !sessionId) {
      setData(emptyData);
      return;
    }
    const client = supabase;
    let isMounted = true;
    let refreshTimer: number | undefined;

    async function loadFromSupabase() {
      try {
        const remoteData = await fetchAppDataFromSupabase(sessionId);
        if (!isMounted) return;
        if (remoteData) {
          const savedWorkspaceId = sessionStorage.getItem(`timeflow-active-workspace-${sessionId}`);
          setData((current) => {
            const preferredId = current.activeWorkspaceId || savedWorkspaceId || "";
            return {
              ...remoteData,
              activeWorkspaceId: remoteData.workspaces.some(
                (workspace) => workspace.id === preferredId,
              )
                ? preferredId
                : remoteData.activeWorkspaceId,
            };
          });
          setDataError("");
        } else {
          setData(emptyData);
          setDataError("");
        }
      } catch (error) {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : "Unknown Supabase error";
        setDataError(`Could not load workspace data from Supabase: ${message}`);
      } finally {
        if (isMounted) setLoading(false);
      }
    }

    const scheduleRefresh = () => {
      if (!isMounted) return;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      refreshTimer = window.setTimeout(() => {
        void loadFromSupabase();
      }, 250);
    };

    void loadFromSupabase();

    const realtimeTables = [
      "workspaces",
      "profiles",
      "workspace_members",
      "projects",
      "tasks",
      "tags",
      "time_entries",
      "active_timers",
      "audit_events",
    ];
    let channel: ReturnType<typeof client.channel> | undefined;
    if (typeof client.channel === "function") {
      const nextChannel = client.channel(`workspace-realtime-${sessionId}`);
      for (const table of realtimeTables) {
        nextChannel.on(
          "postgres_changes",
          { event: "*", schema: "public", table },
          scheduleRefresh,
        );
      }
      channel = nextChannel.subscribe();
    }

    return () => {
      isMounted = false;
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer);
      if (channel && typeof client.removeChannel === "function") {
        void client.removeChannel(channel);
      }
    };
  }, [sessionId, initialData]);
  const auditEvent = (action: string, target: string, detail: string): AuditEvent => ({
    id: uid("audit"),
    workspaceId: data.activeWorkspaceId,
    actorId: sessionId,
    action,
    target,
    detail,
    createdAt: new Date().toISOString(),
  });

  const reportSyncError = (action: string, operation: Promise<void>) => {
    void operation.catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown Supabase error";
      setDataError(`Could not ${action}: ${message}`);
    });
  };

  const addAudit = (action: string, target: string, detail: string) => {
    if (!sessionId) return;
    const event: AuditEvent = {
      id: uid("audit"),
      workspaceId: data.activeWorkspaceId,
      actorId: sessionId,
      action,
      target,
      detail,
      createdAt: new Date().toISOString(),
    };
    reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
    setData((current) => ({ ...current, audit: [event, ...current.audit] }));
  };

  const login = (email: string, userOverride?: User, remoteData?: AppData) => {
    const sourceData = remoteData || data;
    const user =
      userOverride ||
      sourceData.users.find(
        (candidate) =>
          candidate.email.toLowerCase() === email.toLowerCase() && candidate.status === "active",
      );
    if (!user || user.status !== "active") return false;
    const activeWorkspaceId = user.workspaceIds.includes(sourceData.activeWorkspaceId)
      ? sourceData.activeWorkspaceId
      : user.workspaceIds[0] || "";
    setData({
      ...sourceData,
      activeWorkspaceId,
      users: sourceData.users.some((candidate) => candidate.id === user.id)
        ? sourceData.users
        : [...sourceData.users, user],
    });
    setSessionId(user.id);
    return true;
  };

  const register = async (name: string, email: string, customId?: string): Promise<User> => {
    const workspaceId = uid("workspace");
    const user: User = {
      id: customId || uid("user"),
      workspaceIds: [workspaceId],
      name,
      email,
      role: "admin",
      status: "active",
      joinedAt: new Date().toISOString(),
      avatar: name
        .split(" ")
        .map((part) => part[0])
        .join("")
        .slice(0, 2)
        .toUpperCase(),
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timeFormat: "12h",
    };
    const workspace = { id: workspaceId, name: `${name.split(" ")[0]}'s Workspace` };
    await registerWorkspaceAccount(user, workspace);
    const remoteData = await fetchAppDataFromSupabase(user.id);
    if (!remoteData) throw new Error("Supabase did not return workspace access after registration.");
    const registeredUser = remoteData.users.find((candidate) => candidate.id === user.id);
    if (!registeredUser) throw new Error("The registered profile could not be loaded.");
    setData(remoteData);
    setSessionId(user.id);
    setDataError("");
    return registeredUser;
  };

  const startTimer: AppStoreValue["startTimer"] = (input) => {
    if (timerLock.current) return;
    timerLock.current = true;
    setTimerBusy(true);
    setTimerError("");
    if (!sessionId) {
      setTimerError("Your session expired. Sign in before starting a timer.");
      timerLock.current = false;
      setTimerBusy(false);
      return;
    }
    if (data.activeTimer) {
      setTimerError("A timer is already active in this workspace.");
      timerLock.current = false;
      setTimerBusy(false);
      return;
    }
    const now = new Date().toISOString();
    const newTimer: ActiveTimer = {
      id: uid("timer"),
      workspaceId: data.activeWorkspaceId,
      userId: sessionId,
      ...input,
      startedAt: now,
      status: "running",
      segments: [{ id: uid("segment"), type: "work", start: now }],
    };
    setData((current) => ({
      ...current,
      activeTimer: newTimer,
    }));
    void syncActiveTimerToSupabase(newTimer, newTimer.userId, "start").catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Could not start timer in Supabase.";
      setTimerError(
        message.toLowerCase().includes("duplicate") || message.includes("23505")
          ? "A timer is already active for your account."
          : `Could not start timer: ${message}`,
      );
      setData((current) =>
        current.activeTimer?.id === newTimer.id
          ? { ...current, activeTimer: undefined }
          : current,
      );
    });
    queueMicrotask(() => {
      timerLock.current = false;
      setTimerBusy(false);
    });
  };

  const runTimerAction = (action: "pause" | "resume" | "stop") => {
    if (timerLock.current) return;
    timerLock.current = true;
    setTimerBusy(true);
    setTimerError("");
    lastTimerAction.current = action;
    const timer = data.activeTimer;
    if (!timer) {
      setTimerError("The active timer could not be found. Retry after refreshing the page.");
      queueMicrotask(() => {
        timerLock.current = false;
        setTimerBusy(false);
      });
      return;
    }
    try {
      if (action === "pause") {
        const paused = pauseActiveTimer(timer);
        reportSyncError("save timer to Supabase", syncActiveTimerToSupabase(paused));
        setData((current) => ({ ...current, activeTimer: paused }));
      } else if (action === "resume") {
        const resumed = resumeActiveTimer(timer);
        reportSyncError("save timer to Supabase", syncActiveTimerToSupabase(resumed));
        setData((current) => ({ ...current, activeTimer: resumed }));
      } else {
        const entry = completeActiveTimer(timer);
        const event = {
          ...auditEvent("Stopped timer", entry.description, "Saved timer entry"),
          workspaceId: timer.workspaceId,
        };
        reportSyncError(
          "remove timer from Supabase",
          syncActiveTimerToSupabase(undefined, timer.userId),
        );
        reportSyncError("save time entry to Supabase", syncEntryToSupabase(entry, false));
        reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
        setData((current) => ({
          ...current,
          activeTimer: undefined,
          entries: current.entries.some((candidate) => candidate.id === entry.id)
            ? current.entries
            : [entry, ...current.entries],
          audit: current.audit.some((candidate) => candidate.id === event.id)
            ? current.audit
            : [event, ...current.audit],
        }));
      }
    } catch (error) {
      setTimerError(error instanceof Error ? error.message : "The timer action failed.");
    }
    queueMicrotask(() => {
      timerLock.current = false;
      setTimerBusy(false);
    });
  };

  const pauseTimer = () => runTimerAction("pause");
  const resumeTimer = () => runTimerAction("resume");
  const stopTimer = () => runTimerAction("stop");

  const saveEntry = (input: EntryInput, correctionReason?: string) => {
    const cleanDescription = input.description.trim();
    const startMs = new Date(input.start).getTime();
    const endMs = new Date(input.end).getTime();
    if (!cleanDescription || Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
      setDataError("Enter a valid description, start time, and end time.");
      return;
    }
    const existing = input.id
      ? data.entries.find((entry) => entry.id === input.id)
      : undefined;
    if (existing && existing.workspaceId !== data.activeWorkspaceId) return;
    if (existing && existing.userId !== sessionId && !correctionReason?.trim()) {
      setDataError("A correction reason is required when editing a team member's entry.");
      return;
    }
    const project = data.projects.find(
      (candidate) =>
        candidate.id === input.projectId && candidate.workspaceId === data.activeWorkspaceId,
    );
    const task = data.tasks.find(
      (candidate) =>
        candidate.id === input.taskId &&
        candidate.workspaceId === data.activeWorkspaceId &&
        candidate.projectId === project?.id,
    );
    const validTagIds = input.tagIds.filter((tagId) =>
      data.tags.some(
        (tag) => tag.id === tagId && tag.workspaceId === data.activeWorkspaceId,
      ),
    );
    const entry: TimeEntry = {
      ...input,
      description: cleanDescription,
      id: input.id || uid("entry"),
      workspaceId: input.workspaceId || data.activeWorkspaceId,
      projectId: project?.id,
      taskId: task?.id,
      tagIds: validTagIds,
      source: input.source || "manual",
      segments: input.segments || [
        { id: uid("segment"), type: "work", start: input.start, end: input.end },
      ],
    };
    const event: AuditEvent = {
      id: uid("audit"),
      workspaceId: data.activeWorkspaceId,
      actorId: sessionId,
      action:
        existing && existing.userId !== sessionId
          ? "Admin corrected time entry"
          : existing
            ? "Updated time entry"
            : "Created time entry",
      target: entry.description,
      detail: existing ? "Entry values changed" : "Manual entry added",
      reason: correctionReason,
      previousValue: existing ? JSON.stringify(existing) : undefined,
      updatedValue: existing ? JSON.stringify(entry) : undefined,
      createdAt: new Date().toISOString(),
    };
    reportSyncError(
      "save time entry to Supabase",
      syncEntryToSupabase(entry, Boolean(existing)),
    );
    reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
    setData((current) => ({
      ...current,
      entries: current.entries.some((candidate) => candidate.id === entry.id)
        ? current.entries.map((candidate) => (candidate.id === entry.id ? entry : candidate))
        : [entry, ...current.entries],
      audit: current.audit.some((candidate) => candidate.id === event.id)
        ? current.audit
        : [event, ...current.audit],
    }));
  };

  const deleteEntry = (id: string) => {
    const target = data.entries.find((entry) => entry.id === id);
    const event: AuditEvent = {
      id: uid("audit"),
      workspaceId: data.activeWorkspaceId,
      actorId: sessionId,
      action: "Deleted time entry",
      target: target?.description || "Time entry",
      detail: "Entry removed from the workspace",
      createdAt: new Date().toISOString(),
    };
    reportSyncError("delete time entry from Supabase", deleteEntryFromSupabase(id));
    reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
    setData((current) => ({
      ...current,
      entries: current.entries.filter((entry) => entry.id !== id),
      audit: current.audit.some((candidate) => candidate.id === event.id)
        ? current.audit
        : [event, ...current.audit],
    }));
  };

  const saveProject: AppStoreValue["saveProject"] = (project) => {
    const exists = data.projects.some((candidate) => candidate.id === project.id);
    const next: Project = {
      ...project,
      workspaceId: project.workspaceId || data.activeWorkspaceId,
      createdAt: project.createdAt || new Date().toISOString(),
    };
    const event = auditEvent(
      exists ? "Updated project" : "Created project",
      next.name,
      next.description,
    );
    reportSyncError("save project to Supabase", syncProjectToSupabase(next));
    reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
    setData((current) => ({
      ...current,
      projects: current.projects.some((candidate) => candidate.id === next.id)
        ? current.projects.map((candidate) => (candidate.id === next.id ? next : candidate))
        : [next, ...current.projects],
      audit: current.audit.some((candidate) => candidate.id === event.id)
        ? current.audit
        : [event, ...current.audit],
    }));
  };

  const archiveProject = (id: string) => {
    const project = data.projects.find((candidate) => candidate.id === id);
    const nextStatus = project?.status === "active" ? "archived" : "active";
    if (project) {
      reportSyncError(
        "update project in Supabase",
        syncProjectToSupabase({ ...project, status: nextStatus }),
      );
    }
    const event = auditEvent(
      nextStatus === "archived" ? "Archived project" : "Restored project",
      project?.name || "Project",
      `Status changed to ${nextStatus}`,
    );
    reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
    setData((current) => ({
      ...current,
      projects: current.projects.map((candidate) =>
        candidate.id === id ? { ...candidate, status: nextStatus } : candidate,
      ),
      audit: current.audit.some((candidate) => candidate.id === event.id)
        ? current.audit
        : [event, ...current.audit],
    }));
  };

  const saveTask = (task: Task) => {
    if (
      task.workspaceId !== data.activeWorkspaceId ||
      !data.projects.some(
        (project) =>
          project.id === task.projectId && project.workspaceId === data.activeWorkspaceId,
      )
    )
      return;
    const exists = data.tasks.some((candidate) => candidate.id === task.id);
    const event = auditEvent(
      exists ? "Updated task" : "Created task",
      task.name,
      task.completed ? "Marked complete" : "Task saved",
    );
    reportSyncError("save task to Supabase", syncTaskToSupabase(task));
    reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
    setData((current) => ({
      ...current,
      tasks: current.tasks.some((candidate) => candidate.id === task.id)
        ? current.tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
        : [...current.tasks, task],
      audit: current.audit.some((candidate) => candidate.id === event.id)
        ? current.audit
        : [event, ...current.audit],
    }));
  };

  const saveTag = (tag: Tag) => {
    const cleanName = tag.name.trim();
    if (!cleanName) {
      setDataError("Tag name cannot be empty.");
      return;
    }
    const duplicate = data.tags.some(
      (candidate) =>
        candidate.workspaceId === data.activeWorkspaceId &&
        candidate.id !== tag.id &&
        candidate.name.trim().toLowerCase() === cleanName.toLowerCase(),
    );
    if (duplicate) {
      setDataError(`A tag named "${cleanName}" already exists in this workspace.`);
      return;
    }
    const normalizedTag = { ...tag, name: cleanName };
    const exists = data.tags.some((candidate) => candidate.id === normalizedTag.id);
    const event = auditEvent(
      exists ? "Updated tag" : "Created tag",
      normalizedTag.name,
      `Color ${normalizedTag.color}`,
    );
    reportSyncError("save tag to Supabase", syncTagToSupabase(normalizedTag));
    reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
    setData((current) => ({
      ...current,
      tags: current.tags.some((candidate) => candidate.id === normalizedTag.id)
        ? current.tags.map((candidate) =>
            candidate.id === normalizedTag.id ? normalizedTag : candidate,
          )
        : [...current.tags, normalizedTag],
      audit: current.audit.some((candidate) => candidate.id === event.id)
        ? current.audit
        : [event, ...current.audit],
    }));
  };

  const deleteTag = (id: string) => {
    const tag = data.tags.find((candidate) => candidate.id === id);
    const event = auditEvent(
      "Deleted tag",
      tag?.name || "Tag",
      "Removed tag from all time entries",
    );
    reportSyncError("delete tag from Supabase", deleteTagFromSupabase(id));
    reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
    setData((current) => ({
      ...current,
      tags: current.tags.filter((candidate) => candidate.id !== id),
      entries: current.entries.map((entry) => ({
        ...entry,
        tagIds: entry.tagIds.filter((tagId) => tagId !== id),
      })),
      audit: current.audit.some((candidate) => candidate.id === event.id)
        ? current.audit
        : [event, ...current.audit],
    }));
  };

  const saveUser = (user: User) =>
    setData((current) => {
      reportSyncError(
        "update workspace membership in Supabase",
        updateWorkspaceMemberInSupabase(current.activeWorkspaceId, {
          ...user,
          status: user.status === "inactive" ? "inactive" : "active",
        }),
      );
      const membership = {
        workspaceId: current.activeWorkspaceId,
        userId: user.id,
        role: user.role,
        status: user.status === "inactive" ? "inactive" as const : "active" as const,
        createdAt:
          current.workspaceMemberships?.find(
            (candidate) =>
              candidate.workspaceId === current.activeWorkspaceId && candidate.userId === user.id,
          )?.createdAt || user.joinedAt,
      };
      return {
        ...current,
        workspaceMemberships: [
          ...(current.workspaceMemberships || []).filter(
            (candidate) =>
              candidate.workspaceId !== membership.workspaceId ||
              candidate.userId !== membership.userId,
          ),
          membership,
        ],
        users: current.users.some((candidate) => candidate.id === user.id)
          ? current.users.map((candidate) => (candidate.id === user.id ? user : candidate))
          : [...current.users, user],
      };
    });

  const updateProfile = (patch: Partial<User>) =>
    setData((current) => {
      const updatedUser = current.users.find((user) => user.id === sessionId);
      if (updatedUser) {
        reportSyncError(
          "update profile in Supabase",
          updateMyProfileInSupabase({ ...updatedUser, ...patch }),
        );
      }
      return {
        ...current,
        users: current.users.map((user) => (user.id === sessionId ? { ...user, ...patch } : user)),
      };
    });

  const updateWorkspaceName = async (name: string) => {
    const cleanName = name.trim();
    if (!cleanName) {
      throw new Error("A workspace name is required.");
    }
    if (currentUser?.role !== "admin") {
      throw new Error("Only workspace admins can rename the workspace.");
    }
    const workspaceId = data.activeWorkspaceId;
    if (isSupabaseConfigured && supabase && !initialData) {
      await updateWorkspaceNameInSupabase(workspaceId, cleanName);
    }
    const event = auditEvent(
      "Renamed workspace",
      cleanName,
      `Workspace name updated to ${cleanName}`,
    );
    reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
    setData((current) => ({
      ...current,
      workspaces: current.workspaces.map((workspace) =>
        workspace.id === workspaceId ? { ...workspace, name: cleanName } : workspace,
      ),
      audit: current.audit.some((candidate) => candidate.id === event.id)
        ? current.audit
        : [event, ...current.audit],
    }));
  };

  const scopedData = useMemo<AppData>(() => {
    const workspaceId = data.activeWorkspaceId;
    return {
      ...data,
      workspaces: data.workspaces.filter((workspace) =>
        currentUser?.workspaceIds.includes(workspace.id),
      ),
      users: data.users
        .filter((user) => user.workspaceIds.includes(workspaceId))
        .map((user) => {
          const membership = data.workspaceMemberships?.find(
            (candidate) =>
              candidate.workspaceId === workspaceId && candidate.userId === user.id,
          );
          return membership
            ? { ...user, role: membership.role, status: membership.status }
            : user;
        }),
      workspaceMemberships: (data.workspaceMemberships || []).filter(
        (membership) => membership.workspaceId === workspaceId,
      ),
      projects: data.projects.filter((project) => project.workspaceId === workspaceId),
      tasks: data.tasks.filter((task) => task.workspaceId === workspaceId),
      tags: data.tags.filter((tag) => tag.workspaceId === workspaceId),
      entries: data.entries.filter((entry) => entry.workspaceId === workspaceId),
      audit: data.audit.filter((event) => event.workspaceId === workspaceId),
      activeTimer: data.activeTimer?.workspaceId === workspaceId ? data.activeTimer : undefined,
    };
  }, [data]);

  const value = useMemo<AppStoreValue>(
    () => ({
      data: scopedData,
      currentUser,
      loading,
      dataError,
      timerError,
      timerBusy,
      login,
      register,
      logout: async () => {
        if (supabase) {
          const { error } = await supabase.auth.signOut();
          if (error) {
            setDataError(`Could not sign out from Supabase: ${error.message}`);
            return;
          }
        }
        setSessionId("");
        setData(emptyData);
        setDataError("");
      },
      switchWorkspace: (activeWorkspaceId) => {
        if (sessionId) {
          sessionStorage.setItem(`timeflow-active-workspace-${sessionId}`, activeWorkspaceId);
        }
        setData((current) => {
          if (!currentUser?.workspaceIds.includes(activeWorkspaceId)) return current;
          return {
            ...current,
            activeWorkspaceId,
            users: current.users.map((user) => {
              const membership = current.workspaceMemberships?.find(
                (candidate) =>
                  candidate.workspaceId === activeWorkspaceId && candidate.userId === user.id,
              );
              return membership
                ? { ...user, role: membership.role, status: membership.status }
                : user;
            }),
          };
        });
      },
      startTimer,
      pauseTimer,
      resumeTimer,
      stopTimer,
      retryTimerAction: () => {
        if (lastTimerAction.current) runTimerAction(lastTimerAction.current);
      },
      clearTimerError: () => setTimerError(""),
      saveEntry,
      deleteEntry,
      saveProject,
      archiveProject,
      saveTask,
      saveTag,
      deleteTag,
      saveUser,
      inviteMember: async (email, role) => {
        await inviteWorkspaceMemberInSupabase(data.activeWorkspaceId, email, role);
      },
      updateProfile,
      updateWorkspaceName,
      addAudit,
    }),
    [scopedData, currentUser, loading, dataError, timerError, timerBusy],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error("useAppStore must be used within AppStoreProvider");
  return value;
}
