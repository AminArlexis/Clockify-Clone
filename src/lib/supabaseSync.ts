import { supabase, isSupabaseConfigured } from './supabase';
import type { AppData, Project, Task, Tag, TimeEntry, ActiveTimer, AuditEvent, User, Workspace } from '../types';

export async function fetchAppDataFromSupabase(): Promise<AppData | null> {
  if (!isSupabaseConfigured) return null;

  try {
    const [
      workspacesRes,
      profilesRes,
      projectsRes,
      tasksRes,
      tagsRes,
      entriesRes,
      timerRes,
      auditRes,
    ] = await Promise.all([
      supabase.from('workspaces').select('*'),
      supabase.from('profiles').select('*'),
      supabase.from('projects').select('*'),
      supabase.from('tasks').select('*'),
      supabase.from('tags').select('*'),
      supabase.from('time_entries').select('*').order('start_time', { ascending: false }),
      supabase.from('active_timers').select('*').limit(1).maybeSingle(),
      supabase.from('audit_events').select('*').order('created_at', { ascending: false }).limit(100),
    ]);

    if (workspacesRes.error) {
      console.warn('Supabase workspaces fetch warning/error:', workspacesRes.error.message);
    }
    if (profilesRes.error) {
      console.warn('Supabase profiles fetch warning/error:', profilesRes.error.message);
    }

    let workspaces: Workspace[] = (workspacesRes.data || []).map((w: any) => ({
      id: w.id,
      name: w.name,
    }));

    // If workspaces table returned empty or permission blocked, extract workspace IDs from fetched profiles or default
    if (workspaces.length === 0) {
      const discoveredIds = new Set<string>();
      (profilesRes.data || []).forEach((u: any) => {
        (u.workspace_ids || []).forEach((wid: string) => discoveredIds.add(wid));
      });
      if (discoveredIds.size > 0) {
        workspaces = Array.from(discoveredIds).map((wid) => ({
          id: wid,
          name: wid === 'w1' ? 'Acme Corp' : wid === 'w2' ? 'Design Studio' : 'Workspace',
        }));
      }
    }

    // If neither workspaces nor profiles could be loaded from Supabase, return null
    if (workspaces.length === 0 && (!profilesRes.data || profilesRes.data.length === 0)) {
      return null;
    }

    // Fallback if profiles exist but no workspaces
    if (workspaces.length === 0) {
      workspaces = [{ id: 'w1', name: 'Default Workspace' }];
    }

    const users: User[] = (profilesRes.data || []).map((u: any) => ({
      id: u.id,
      workspaceIds: u.workspace_ids || [],
      name: u.name,
      email: u.email,
      role: u.role,
      status: u.status,
      joinedAt: u.joined_at,
      avatar: u.avatar || '',
      timezone: u.timezone || 'UTC',
      timeFormat: u.time_format || '12h',
    }));

    const projects: Project[] = (projectsRes.data || []).map((p: any) => ({
      id: p.id,
      workspaceId: p.workspace_id,
      name: p.name,
      client: p.client || '',
      description: p.description || '',
      color: p.color || '#3b82f6',
      status: p.status || 'active',
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
      color: t.color || '#6b7280',
      archived: Boolean(t.archived),
    }));

    const entries: TimeEntry[] = (entriesRes.data || []).map((e: any) => ({
      id: e.id,
      workspaceId: e.workspace_id,
      userId: e.user_id,
      description: e.description || '',
      projectId: e.project_id || undefined,
      taskId: e.task_id || undefined,
      tagIds: e.tag_ids || [],
      start: e.start_time,
      end: e.end_time,
      source: e.source || 'timer',
      segments: Array.isArray(e.segments) ? e.segments : [],
      notes: e.notes || undefined,
    }));

    let activeTimer: ActiveTimer | undefined = undefined;
    if (timerRes.data) {
      const at = timerRes.data;
      activeTimer = {
        id: at.id,
        workspaceId: at.workspace_id,
        userId: at.user_id,
        description: at.description || '',
        projectId: at.project_id || undefined,
        taskId: at.task_id || undefined,
        tagIds: at.tag_ids || [],
        startedAt: at.started_at,
        status: at.status || 'running',
        segments: Array.isArray(at.segments) ? at.segments : [],
      };
    }

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
      activeWorkspaceId: workspaces[0].id,
      projects,
      tasks,
      tags,
      entries,
      activeTimer,
      audit,
    };
  } catch (err) {
    console.error('Failed to fetch data from Supabase:', err);
    return null;
  }
}

export async function syncUserToSupabase(user: User, workspace?: Workspace) {
  if (!isSupabaseConfigured) return;
  try {
    if (workspace) {
      await supabase.from('workspaces').upsert({
        id: workspace.id,
        name: workspace.name,
      });
    }
    await supabase.from('profiles').upsert({
      id: user.id,
      workspace_ids: user.workspaceIds,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      joined_at: user.joinedAt,
      avatar: user.avatar,
      timezone: user.timezone,
      time_format: user.timeFormat,
    });
  } catch (err) {
    console.error('Failed to sync profile to Supabase:', err);
  }
}

export async function syncEntryToSupabase(entry: TimeEntry) {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('time_entries').upsert({
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
  } catch (err) {
    console.error('Failed to sync entry to Supabase:', err);
  }
}

export async function deleteEntryFromSupabase(id: string) {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('time_entries').delete().eq('id', id);
  } catch (err) {
    console.error('Failed to delete entry from Supabase:', err);
  }
}

export async function syncProjectToSupabase(project: Project) {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('projects').upsert({
      id: project.id,
      workspace_id: project.workspaceId,
      name: project.name,
      client: project.client,
      description: project.description,
      color: project.color,
      status: project.status,
      created_at: project.createdAt,
    });
  } catch (err) {
    console.error('Failed to sync project to Supabase:', err);
  }
}

export async function syncTaskToSupabase(task: Task) {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('tasks').upsert({
      id: task.id,
      workspace_id: task.workspaceId,
      project_id: task.projectId,
      name: task.name,
      assignee_id: task.assigneeId || null,
      completed: task.completed,
    });
  } catch (err) {
    console.error('Failed to sync task to Supabase:', err);
  }
}

export async function syncTagToSupabase(tag: Tag) {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('tags').upsert({
      id: tag.id,
      workspace_id: tag.workspaceId,
      name: tag.name,
      color: tag.color,
      archived: tag.archived || false,
    });
  } catch (err) {
    console.error('Failed to sync tag to Supabase:', err);
  }
}

export async function deleteTagFromSupabase(id: string) {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('tags').delete().eq('id', id);
  } catch (err) {
    console.error('Failed to delete tag from Supabase:', err);
  }
}

export async function syncActiveTimerToSupabase(timer?: ActiveTimer) {
  if (!isSupabaseConfigured) return;
  try {
    if (!timer) {
      await supabase.from('active_timers').delete().neq('id', '');
    } else {
      await supabase.from('active_timers').upsert({
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
      });
    }
  } catch (err) {
    console.error('Failed to sync timer to Supabase:', err);
  }
}

export async function syncAuditEventToSupabase(event: AuditEvent) {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('audit_events').upsert({
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
  } catch (err) {
    console.error('Failed to sync audit event to Supabase:', err);
  }
}

export async function deleteProjectFromSupabase(id: string) {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('projects').delete().eq('id', id);
  } catch (err) {
    console.error('Failed to delete project from Supabase:', err);
  }
}

export async function deleteTaskFromSupabase(id: string) {
  if (!isSupabaseConfigured) return;
  try {
    await supabase.from('tasks').delete().eq('id', id);
  } catch (err) {
    console.error('Failed to delete task from Supabase:', err);
  }
}

export async function seedInitialDataToSupabase(initialData: AppData): Promise<boolean> {
  if (!isSupabaseConfigured) return false;

  try {
    // 1. Workspaces
    if (initialData.workspaces.length > 0) {
      await supabase.from('workspaces').upsert(
        initialData.workspaces.map((w) => ({
          id: w.id,
          name: w.name,
        }))
      );
    }

    // 2. Profiles
    if (initialData.users.length > 0) {
      await supabase.from('profiles').upsert(
        initialData.users.map((u) => ({
          id: u.id,
          workspace_ids: u.workspaceIds,
          name: u.name,
          email: u.email,
          role: u.role,
          status: u.status,
          joined_at: u.joinedAt,
          avatar: u.avatar,
          timezone: u.timezone,
          time_format: u.timeFormat,
        }))
      );
    }

    // 3. Projects
    if (initialData.projects.length > 0) {
      await supabase.from('projects').upsert(
        initialData.projects.map((p) => ({
          id: p.id,
          workspace_id: p.workspaceId,
          name: p.name,
          client: p.client,
          description: p.description,
          color: p.color,
          status: p.status,
          created_at: p.createdAt,
        }))
      );
    }

    // 4. Tasks
    if (initialData.tasks.length > 0) {
      await supabase.from('tasks').upsert(
        initialData.tasks.map((t) => ({
          id: t.id,
          workspace_id: t.workspaceId,
          project_id: t.projectId,
          name: t.name,
          assignee_id: t.assigneeId || null,
          completed: t.completed,
        }))
      );
    }

    // 5. Tags
    if (initialData.tags.length > 0) {
      await supabase.from('tags').upsert(
        initialData.tags.map((t) => ({
          id: t.id,
          workspace_id: t.workspaceId,
          name: t.name,
          color: t.color,
          archived: t.archived || false,
        }))
      );
    }

    // 6. Entries
    if (initialData.entries.length > 0) {
      await supabase.from('time_entries').upsert(
        initialData.entries.map((e) => ({
          id: e.id,
          workspace_id: e.workspaceId,
          user_id: e.userId,
          description: e.description,
          project_id: e.projectId || null,
          task_id: e.taskId || null,
          tag_ids: e.tagIds,
          start_time: e.start,
          end_time: e.end,
          source: e.source,
          segments: e.segments,
          notes: e.notes || null,
        }))
      );
    }

    return true;
  } catch (err) {
    console.error('Error seeding initial data to Supabase:', err);
    return false;
  }
}
