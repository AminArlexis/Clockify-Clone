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
  const [dataError, setDataError] = useState("");
  const [timerError, setTimerError] = useState("");
  const [timerBusy, setTimerBusy] = useState(false);
  const timerLock = useRef(false);
  const lastTimerAction = useRef<"pause" | "resume" | "stop" | null>(null);
  const currentUser = data.users.find((user) => user.id === sessionId);

  useEffect(() => {
    localStorage.removeItem(LEGACY_DATA_KEY);
    localStorage.removeItem(LEGACY_SESSION_KEY);
    localStorage.removeItem(LEGACY_SESSION_EXPIRY_KEY);
  }, []);

  useEffect(() => {
    if (initialData || initialSessionId || !supabase) return;
    let active = true;
    void supabase.auth
      .getSession()
      .then(({ data: sessionData, error }) => {
        if (!active) return;
        if (error) {
          setDataError(`Could not restore Supabase session: ${error.message}`);
          return;
        }
        setSessionId(sessionData.session?.user.id || "");
      })
      .catch((error: unknown) => {
        if (active) {
          const message = error instanceof Error ? error.message : "Unknown Supabase error";
          setDataError(`Could not restore Supabase session: ${message}`);
        }
      });

    return () => {
      active = false;
    };
  }, [initialData, initialSessionId]);

  useEffect(() => {
    if (initialData) return;
    if (!isSupabaseConfigured || !supabase || !sessionId) {
      setData(emptyData);
      return;
    }
    let isMounted = true;
    async function initSupabase() {
      try {
        const remoteData = await fetchAppDataFromSupabase(sessionId);
        if (!isMounted) return;
        if (remoteData) {
          setData(remoteData);
          setDataError("");
        } else {
          setData(emptyData);
          setDataError("");
        }
      } catch (error) {
        if (!isMounted) return;
        const message = error instanceof Error ? error.message : "Unknown Supabase error";
        setDataError(`Could not load workspace data from Supabase: ${message}`);
      }
    }

    void initSupabase();
    return () => {
      isMounted = false;
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
    reportSyncError("save timer to Supabase", syncActiveTimerToSupabase(newTimer));
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
    setData((current) => {
      const timer = current.activeTimer;
      if (!timer) {
        setTimerError("The active timer could not be found. Retry after refreshing the page.");
        return current;
      }
      try {
        if (action === "pause") {
          const paused = pauseActiveTimer(timer);
          reportSyncError("save timer to Supabase", syncActiveTimerToSupabase(paused));
          return { ...current, activeTimer: paused };
        }
        if (action === "resume") {
          const resumed = resumeActiveTimer(timer);
          reportSyncError("save timer to Supabase", syncActiveTimerToSupabase(resumed));
          return { ...current, activeTimer: resumed };
        }
        const entry = completeActiveTimer(timer);
        const event = {
          ...auditEvent("Stopped timer", entry.description, "Saved timer entry"),
          workspaceId: timer.workspaceId,
        };
        reportSyncError(
          "remove timer from Supabase",
          syncActiveTimerToSupabase(undefined, timer.userId),
        );
        reportSyncError("save time entry to Supabase", syncEntryToSupabase(entry));
        reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
        return {
          ...current,
          activeTimer: undefined,
          entries: [entry, ...current.entries],
          audit: [event, ...current.audit],
        };
      } catch (error) {
        setTimerError(error instanceof Error ? error.message : "The timer action failed.");
        return current;
      }
    });
    queueMicrotask(() => {
      timerLock.current = false;
      setTimerBusy(false);
    });
  };

  const pauseTimer = () => runTimerAction("pause");
  const resumeTimer = () => runTimerAction("resume");
  const stopTimer = () => runTimerAction("stop");

  const saveEntry = (input: EntryInput, correctionReason?: string) =>
    setData((current) => {
      const existing = input.id
        ? current.entries.find((entry) => entry.id === input.id)
        : undefined;
      if (existing && existing.workspaceId !== current.activeWorkspaceId) return current;
      const project = current.projects.find(
        (candidate) =>
          candidate.id === input.projectId && candidate.workspaceId === current.activeWorkspaceId,
      );
      const task = current.tasks.find(
        (candidate) =>
          candidate.id === input.taskId &&
          candidate.workspaceId === current.activeWorkspaceId &&
          candidate.projectId === project?.id,
      );
      const validTagIds = input.tagIds.filter((tagId) =>
        current.tags.some(
          (tag) => tag.id === tagId && tag.workspaceId === current.activeWorkspaceId,
        ),
      );
      const entry: TimeEntry = {
        ...input,
        id: input.id || uid("entry"),
        workspaceId: input.workspaceId || current.activeWorkspaceId,
        projectId: project?.id,
        taskId: task?.id,
        tagIds: validTagIds,
        source: input.source || "manual",
        segments: input.segments || [
          { id: uid("segment"), type: "work", start: input.start, end: input.end },
        ],
      };
      const entries = existing
        ? current.entries.map((candidate) => (candidate.id === entry.id ? entry : candidate))
        : [entry, ...current.entries];
      const event: AuditEvent = {
        id: uid("audit"),
        workspaceId: current.activeWorkspaceId,
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
      reportSyncError("save time entry to Supabase", syncEntryToSupabase(entry as TimeEntry));
      reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
      return { ...current, entries, audit: [event, ...current.audit] };
    });

  const deleteEntry = (id: string) =>
    setData((current) => {
      const target = current.entries.find((entry) => entry.id === id);
      const event: AuditEvent = {
        id: uid("audit"),
        workspaceId: current.activeWorkspaceId,
        actorId: sessionId,
        action: "Deleted time entry",
        target: target?.description || "Time entry",
        detail: "Entry removed from the workspace",
        createdAt: new Date().toISOString(),
      };
      reportSyncError("delete time entry from Supabase", deleteEntryFromSupabase(id));
      reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
      return {
        ...current,
        entries: current.entries.filter((entry) => entry.id !== id),
        audit: [event, ...current.audit],
      };
    });

  const saveProject: AppStoreValue["saveProject"] = (project) =>
    setData((current) => {
      const exists = current.projects.some((candidate) => candidate.id === project.id);
      const next = {
        ...project,
        workspaceId: project.workspaceId || current.activeWorkspaceId,
        createdAt: project.createdAt || new Date().toISOString(),
      };
      const event = auditEvent(
        exists ? "Updated project" : "Created project",
        next.name,
        next.description,
      );
      reportSyncError("save project to Supabase", syncProjectToSupabase(next as Project));
      reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
      return {
        ...current,
        projects: exists
          ? current.projects.map((candidate) => (candidate.id === project.id ? next : candidate))
          : [next, ...current.projects],
        audit: [event, ...current.audit],
      };
    });

  const archiveProject = (id: string) =>
    setData((current) => {
      const project = current.projects.find((candidate) => candidate.id === id);
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
      return {
        ...current,
        projects: current.projects.map((candidate) =>
          candidate.id === id ? { ...candidate, status: nextStatus } : candidate,
        ),
        audit: [event, ...current.audit],
      };
    });

  const saveTask = (task: Task) =>
    setData((current) => {
      if (
        task.workspaceId !== current.activeWorkspaceId ||
        !current.projects.some(
          (project) =>
            project.id === task.projectId && project.workspaceId === current.activeWorkspaceId,
        )
      )
        return current;
      const exists = current.tasks.some((candidate) => candidate.id === task.id);
      const event = auditEvent(
        exists ? "Updated task" : "Created task",
        task.name,
        task.completed ? "Marked complete" : "Task saved",
      );
      reportSyncError("save task to Supabase", syncTaskToSupabase(task));
      reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
      return {
        ...current,
        tasks: exists
          ? current.tasks.map((candidate) => (candidate.id === task.id ? task : candidate))
          : [...current.tasks, task],
        audit: [event, ...current.audit],
      };
    });

  const saveTag = (tag: Tag) =>
    setData((current) => {
      const exists = current.tags.some((candidate) => candidate.id === tag.id);
      const event = auditEvent(
        exists ? "Updated tag" : "Created tag",
        tag.name,
        `Color ${tag.color}`,
      );
      reportSyncError("save tag to Supabase", syncTagToSupabase(tag));
      reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
      return {
        ...current,
        tags: exists
          ? current.tags.map((candidate) => (candidate.id === tag.id ? tag : candidate))
          : [...current.tags, tag],
        audit: [event, ...current.audit],
      };
    });

  const deleteTag = (id: string) =>
    setData((current) => {
      const tag = current.tags.find((candidate) => candidate.id === id);
      const event = auditEvent(
        "Deleted tag",
        tag?.name || "Tag",
        "Removed tag from all time entries",
      );
      reportSyncError("delete tag from Supabase", deleteTagFromSupabase(id));
      reportSyncError("save audit event to Supabase", syncAuditEventToSupabase(event));
      return {
        ...current,
        tags: current.tags.filter((candidate) => candidate.id !== id),
        entries: current.entries.map((entry) => ({
          ...entry,
          tagIds: entry.tagIds.filter((tagId) => tagId !== id),
        })),
        audit: [event, ...current.audit],
      };
    });

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
      switchWorkspace: (activeWorkspaceId) =>
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
        }),
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
      addAudit,
    }),
    [scopedData, currentUser, dataError, timerError, timerBusy],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error("useAppStore must be used within AppStoreProvider");
  return value;
}
