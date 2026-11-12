import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createMockData } from "../data/mock";
import { completeActiveTimer, pauseActiveTimer, resumeActiveTimer } from "../lib/domain";
import { isSupabaseConfigured } from "../lib/supabase";
import {
  fetchAppDataFromSupabase,
  seedInitialDataToSupabase,
  syncUserToSupabase,
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

const DATA_KEY = "timeflow-prototype-data-v2";
const SESSION_KEY = "timeflow-prototype-session";
const SESSION_EXPIRY_KEY = "timeflow-prototype-session-expiry";
const SESSION_LENGTH = 8 * 60 * 60 * 1000;
const uid = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

interface AppStoreValue {
  data: AppData;
  currentUser?: User;
  sessionExpired: boolean;
  timerError: string;
  timerBusy: boolean;
  login: (email: string, userOverride?: User) => boolean;
  register: (name: string, email: string, customId?: string) => User;
  logout: () => void;
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
  updateProfile: (patch: Partial<User>) => void;
  addAudit: (action: string, target: string, detail: string) => void;
  resetDemo: () => void;
}

const AppStoreContext = createContext<AppStoreValue | null>(null);

function loadData() {
  try {
    const raw = localStorage.getItem(DATA_KEY);
    return raw ? (JSON.parse(raw) as AppData) : createMockData();
  } catch {
    return createMockData();
  }
}

export function AppStoreProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AppData>(loadData);
  const initialSession = localStorage.getItem(SESSION_KEY) || "";
  const initialExpiry = Number(localStorage.getItem(SESSION_EXPIRY_KEY) || 0);
  const [sessionId, setSessionId] = useState(() =>
    initialExpiry > Date.now() ? initialSession : "",
  );
  const [sessionExpired, setSessionExpired] = useState(() =>
    Boolean(initialSession && initialExpiry <= Date.now()),
  );
  const [timerError, setTimerError] = useState("");
  const [timerBusy, setTimerBusy] = useState(false);
  const timerLock = useRef(false);
  const lastTimerAction = useRef<"pause" | "resume" | "stop" | null>(null);
  const currentUser = data.users.find((user) => user.id === sessionId);

  // Sync with Supabase on mount
  useEffect(() => {
    if (!isSupabaseConfigured) return;

    let isMounted = true;
    async function initSupabase() {
      try {
        const remoteData = await fetchAppDataFromSupabase();
        if (!isMounted) return;

        if (remoteData && remoteData.workspaces.length > 0) {
          setData(remoteData);
        } else {
          // Empty database: seed initial mock data to Supabase
          const fallbackData = loadData();
          await seedInitialDataToSupabase(fallbackData);
        }
      } catch (e) {
        console.error("Supabase sync initialization error:", e);
      }
    }

    initSupabase();
    return () => {
      isMounted = false;
    };
  }, []);
  const auditEvent = (action: string, target: string, detail: string): AuditEvent => ({
    id: uid("audit"),
    workspaceId: data.activeWorkspaceId,
    actorId: sessionId,
    action,
    target,
    detail,
    createdAt: new Date().toISOString(),
  });

  useEffect(() => {
    try {
      localStorage.setItem(DATA_KEY, JSON.stringify(data));
    } catch {
      setTimerError("Changes could not be saved in this browser. Free storage and retry.");
    }
  }, [data]);
  useEffect(() => {
    if (sessionId) {
      localStorage.setItem(SESSION_KEY, sessionId);
      localStorage.setItem(SESSION_EXPIRY_KEY, String(Date.now() + SESSION_LENGTH));
    } else {
      localStorage.removeItem(SESSION_KEY);
      localStorage.removeItem(SESSION_EXPIRY_KEY);
    }
  }, [sessionId]);
  useEffect(() => {
    const check = window.setInterval(() => {
      if (sessionId && Number(localStorage.getItem(SESSION_EXPIRY_KEY) || 0) <= Date.now()) {
        setSessionId("");
        setSessionExpired(true);
      }
    }, 30_000);
    return () => window.clearInterval(check);
  }, [sessionId]);

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
    void syncAuditEventToSupabase(event);
    setData((current) => ({ ...current, audit: [event, ...current.audit] }));
  };

  const login = (email: string, userOverride?: User) => {
    const user = userOverride || data.users.find(
      (candidate) =>
        candidate.email.toLowerCase() === email.toLowerCase() && candidate.status === "active",
    );
    if (!user) return false;
    if (user.workspaceIds.length > 0 && !user.workspaceIds.includes(data.activeWorkspaceId)) {
      setData((current) => ({
        ...current,
        users: current.users.some(u => u.id === user.id) ? current.users : [...current.users, user],
        activeWorkspaceId: user.workspaceIds[0]
      }));
    } else {
      setData((current) => ({
        ...current,
        users: current.users.some(u => u.id === user.id) ? current.users : [...current.users, user],
      }));
    }
    setSessionExpired(false);
    setSessionId(user.id);
    return true;
  };

  const register = (name: string, email: string, customId?: string): User => {
    const workspaceId = uid("workspace");
    const user: User = {
      id: customId || uid("user"),
      workspaceIds: [workspaceId],
      name,
      email,
      role: "member",
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
    setData((current) => ({
      ...current,
      users: [...current.users.filter(u => u.id !== user.id), user],
      workspaces: [
        ...current.workspaces.filter(w => w.id !== workspace.id),
        workspace,
      ],
      activeWorkspaceId: workspaceId,
    }));
    setSessionExpired(false);
    setSessionId(user.id);
    void syncUserToSupabase(user, workspace);
    return user;
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
    void syncActiveTimerToSupabase(newTimer);
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
          void syncActiveTimerToSupabase(paused);
          return { ...current, activeTimer: paused };
        }
        if (action === "resume") {
          const resumed = resumeActiveTimer(timer);
          void syncActiveTimerToSupabase(resumed);
          return { ...current, activeTimer: resumed };
        }
        const entry = completeActiveTimer(timer);
        const event = {
          ...auditEvent("Stopped timer", entry.description, "Saved timer entry"),
          workspaceId: timer.workspaceId,
        };
        void syncActiveTimerToSupabase(undefined);
        void syncEntryToSupabase(entry);
        void syncAuditEventToSupabase(event);
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
      void syncEntryToSupabase(entry as TimeEntry);
      void syncAuditEventToSupabase(event);
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
        detail: "Entry removed from prototype data",
        createdAt: new Date().toISOString(),
      };
      void deleteEntryFromSupabase(id);
      void syncAuditEventToSupabase(event);
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
      const event = auditEvent(exists ? "Updated project" : "Created project", next.name, next.description);
      void syncProjectToSupabase(next as Project);
      void syncAuditEventToSupabase(event);
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
        void syncProjectToSupabase({ ...project, status: nextStatus });
      }
      const event = auditEvent(
        nextStatus === "archived" ? "Archived project" : "Restored project",
        project?.name || "Project",
        `Status changed to ${nextStatus}`,
      );
      void syncAuditEventToSupabase(event);
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
      void syncTaskToSupabase(task);
      void syncAuditEventToSupabase(event);
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
      const event = auditEvent(exists ? "Updated tag" : "Created tag", tag.name, `Color ${tag.color}`);
      void syncTagToSupabase(tag);
      void syncAuditEventToSupabase(event);
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
      const event = auditEvent("Deleted tag", tag?.name || "Tag", "Removed tag from all time entries");
      void deleteTagFromSupabase(id);
      void syncAuditEventToSupabase(event);
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
      void syncUserToSupabase(user);
      return {
        ...current,
        users: current.users.some((candidate) => candidate.id === user.id)
          ? current.users.map((candidate) => (candidate.id === user.id ? user : candidate))
          : [...current.users, user],
      };
    });

  const updateProfile = (patch: Partial<User>) =>
    setData((current) => {
      const updatedUser = current.users.find((user) => user.id === sessionId);
      if (updatedUser) {
        void syncUserToSupabase({ ...updatedUser, ...patch });
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
      users: data.users.filter((user) => user.workspaceIds.includes(workspaceId)),
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
      sessionExpired,
      timerError,
      timerBusy,
      login,
      register,
      logout: () => {
        setSessionId("");
        setSessionExpired(false);
      },
      switchWorkspace: (activeWorkspaceId) =>
        setData((current) =>
          currentUser?.workspaceIds.includes(activeWorkspaceId)
            ? { ...current, activeWorkspaceId }
            : current,
        ),
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
      updateProfile,
      addAudit,
      resetDemo: () => {
        localStorage.removeItem(DATA_KEY);
        setData(createMockData());
      },
    }),
    [scopedData, currentUser, sessionExpired, timerError, timerBusy],
  );

  return <AppStoreContext.Provider value={value}>{children}</AppStoreContext.Provider>;
}

export function useAppStore() {
  const value = useContext(AppStoreContext);
  if (!value) throw new Error("useAppStore must be used within AppStoreProvider");
  return value;
}
