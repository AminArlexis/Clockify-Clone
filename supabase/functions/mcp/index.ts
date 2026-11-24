
import "@supabase/functions-js/edge-runtime.d.ts";

import {
  createMcpHandler,
  McpServer,
} from "@modelcontextprotocol/server";

import { pipeline } from "@supabase/middleware";

import {
  withOAuthProtectedResource,
  withSupabase,
} from "@supabase/server";

import { z } from "zod";

// deno-lint-ignore no-explicit-any
type SupabaseClient = any;

function uid(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function jsonContent(payload: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(payload),
      },
    ],
  };
}

function parseIsoDate(value: string, fieldName: string): string {
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) {
    throw new Error(`Invalid ${fieldName}: "${value}". Expected an ISO 8601 datetime.`);
  }
  return new Date(ms).toISOString();
}

async function getAuthenticatedUserId(supabase: SupabaseClient): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    throw new Error(error?.message || "Authenticated user not found.");
  }
  return data.user.id;
}

async function resolveWorkspaceId(
  supabase: SupabaseClient,
  userId: string,
  requestedWorkspaceId?: string,
): Promise<string> {
  if (requestedWorkspaceId) {
    const { data, error } = await supabase
      .from("workspace_members")
      .select("workspace_id")
      .eq("workspace_id", requestedWorkspaceId)
      .eq("user_id", userId)
      .eq("status", "active")
      .maybeSingle();

    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(`You are not an active member of workspace "${requestedWorkspaceId}".`);
    }
    return data.workspace_id;
  }

  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) {
    throw new Error("No active workspace membership found for this user.");
  }
  return data.workspace_id;
}

async function validateEntryReferences(
  supabase: SupabaseClient,
  workspaceId: string,
  refs: {
    projectId?: string | null;
    taskId?: string | null;
    tagIds?: string[];
  },
) {
  if (refs.projectId) {
    const { data, error } = await supabase
      .from("projects")
      .select("id")
      .eq("id", refs.projectId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(`Project "${refs.projectId}" was not found in workspace "${workspaceId}".`);
    }
  }

  if (refs.taskId) {
    const { data, error } = await supabase
      .from("tasks")
      .select("id, project_id")
      .eq("id", refs.taskId)
      .eq("workspace_id", workspaceId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) {
      throw new Error(`Task "${refs.taskId}" was not found in workspace "${workspaceId}".`);
    }
    if (refs.projectId && data.project_id !== refs.projectId) {
      throw new Error(`Task "${refs.taskId}" does not belong to project "${refs.projectId}".`);
    }
  }

  if (refs.tagIds && refs.tagIds.length > 0) {
    const uniqueTagIds = [...new Set(refs.tagIds)];
    const { data, error } = await supabase
      .from("tags")
      .select("id")
      .eq("workspace_id", workspaceId)
      .in("id", uniqueTagIds);
    if (error) throw new Error(error.message);
    const found = new Set((data || []).map((tag: { id: string }) => tag.id));
    const missing = uniqueTagIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new Error(`Tag(s) not found in workspace "${workspaceId}": ${missing.join(", ")}`);
    }
  }
}

async function recordAuditEvent(
  supabase: SupabaseClient,
  event: {
    workspace_id: string;
    actor_id: string;
    action: string;
    target: string;
    detail: string;
    reason?: string;
    previous_value?: string;
    updated_value?: string;
  },
) {
  const { error } = await supabase.from("audit_events").insert({
    id: uid("audit"),
    ...event,
  });
  if (error) {
    console.error("Failed to record MCP audit event:", error.message);
  }
}

Deno.serve(
  pipeline(
    [
      withOAuthProtectedResource(),
      withSupabase({ auth: "user" }),
    ],
    async (req, { supabase }) => {
      const handler = createMcpHandler(() => {
        const server = new McpServer({
          name: "timeflow",
          version: "0.1.0",
        });

          server.registerTool(
            "whoami",
            {
              description: "Get the identity of the authenticated TimeFlow user.",
              inputSchema: z.object({}),
              annotations: { readOnlyHint: true },
            },
            async () => {
              const { data, error } = await supabase.auth.getUser();

              if (error) {
                throw new Error(error.message);
              }

              return jsonContent({
                id: data.user.id,
                email: data.user.email,
              });
            },
          );

          server.registerTool(
            "list_time_entries",
            {
              description:
                "List time entries for the authenticated user (or workspace if admin), optionally filtered by workspace, date range, project, or task.",
              inputSchema: z.object({
                workspace_id: z.string().optional().describe("Filter by workspace ID."),
                from: z.string().optional().describe("Include entries starting at or after this ISO 8601 datetime."),
                to: z.string().optional().describe("Include entries starting at or before this ISO 8601 datetime."),
                project_id: z.string().optional().describe("Filter by project ID."),
                task_id: z.string().optional().describe("Filter by task ID."),
                limit: z.number().int().min(1).max(200).optional().default(50).describe("Maximum entries to return (1-200, default 50)."),
              }),
              annotations: { readOnlyHint: true },
            },
            async ({ workspace_id, from, to, project_id, task_id, limit }) => {
              let query = supabase
                .from("time_entries")
                .select("*")
                .order("start_time", { ascending: false })
                .limit(limit);

              if (workspace_id) query = query.eq("workspace_id", workspace_id);
              if (from) query = query.gte("start_time", parseIsoDate(from, "from"));
              if (to) query = query.lte("start_time", parseIsoDate(to, "to"));
              if (project_id) query = query.eq("project_id", project_id);
              if (task_id) query = query.eq("task_id", task_id);

              const { data, error } = await query;
              if (error) throw new Error(error.message);

              return jsonContent({
                count: data?.length ?? 0,
                entries: data ?? [],
              });
            },
          );

          server.registerTool(
            "create_time_entry",
            {
              description: "Create a manual time entry in TimeFlow.",
              inputSchema: z.object({
                description: z.string().trim().min(1, "Description is required.").describe("What you worked on."),
                start_time: z.string().min(1).describe("Start time in ISO 8601 format (e.g. 2026-11-23T09:00:00+08:00)."),
                end_time: z.string().min(1).describe("End time in ISO 8601 format (must be after start_time)."),
                workspace_id: z.string().optional().describe("Workspace ID. Defaults to your first active workspace."),
                project_id: z.string().optional().describe("Optional project ID."),
                task_id: z.string().optional().describe("Optional task ID."),
                tag_ids: z.array(z.string()).optional().default([]).describe("Optional list of tag IDs."),
                notes: z.string().optional().describe("Optional notes for the time entry."),
              }),
              annotations: { readOnlyHint: false, destructiveHint: false },
            },
            async ({ description, start_time, end_time, workspace_id, project_id, task_id, tag_ids, notes }) => {
              const userId = await getAuthenticatedUserId(supabase);
              const resolvedWorkspaceId = await resolveWorkspaceId(supabase, userId, workspace_id);

              const startIso = parseIsoDate(start_time, "start_time");
              const endIso = parseIsoDate(end_time, "end_time");
              if (Date.parse(endIso) <= Date.parse(startIso)) {
                throw new Error("end_time must be after start_time.");
              }

              const uniqueTagIds = [...new Set(tag_ids)];
              await validateEntryReferences(supabase, resolvedWorkspaceId, {
                projectId: project_id,
                taskId: task_id,
                tagIds: uniqueTagIds,
              });

              const entry = {
                id: uid("entry"),
                workspace_id: resolvedWorkspaceId,
                user_id: userId,
                description,
                project_id: project_id || null,
                task_id: task_id || null,
                tag_ids: uniqueTagIds,
                start_time: startIso,
                end_time: endIso,
                source: "manual",
                segments: [
                  {
                    id: uid("segment"),
                    type: "work",
                    start: startIso,
                    end: endIso,
                  },
                ],
                notes: notes?.trim() || null,
              };

              const { data, error } = await supabase
                .from("time_entries")
                .insert(entry)
                .select("*")
                .single();

              if (error) throw new Error(error.message);

              await recordAuditEvent(supabase, {
                workspace_id: resolvedWorkspaceId,
                actor_id: userId,
                action: "Created time entry",
                target: description,
                detail: "Manual entry added via MCP",
                updated_value: JSON.stringify(data),
              });

              return jsonContent(data);
            },
          );

          server.registerTool(
            "update_time_entry",
            {
              description: "Update an existing time entry by ID.",
              inputSchema: z.object({
                id: z.string().min(1).describe("ID of the time entry to update."),
                description: z.string().trim().min(1).optional().describe("Updated description."),
                start_time: z.string().optional().describe("Updated start time (ISO 8601)."),
                end_time: z.string().optional().describe("Updated end time (ISO 8601)."),
                project_id: z.string().nullable().optional().describe("Updated project ID, or null to clear."),
                task_id: z.string().nullable().optional().describe("Updated task ID, or null to clear."),
                tag_ids: z.array(z.string()).optional().describe("Updated list of tag IDs."),
                notes: z.string().nullable().optional().describe("Updated notes, or null to clear."),
                reason: z.string().optional().describe("Optional reason for the update (recorded in audit log)."),
              }),
              annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true },
            },
            async ({ id, description, start_time, end_time, project_id, task_id, tag_ids, notes, reason }) => {
              const userId = await getAuthenticatedUserId(supabase);

              const { data: existing, error: fetchError } = await supabase
                .from("time_entries")
                .select("*")
                .eq("id", id)
                .maybeSingle();

              if (fetchError) throw new Error(fetchError.message);
              if (!existing) {
                throw new Error(`Time entry "${id}" was not found or is not accessible.`);
              }

            const nextStart = start_time ? parseIsoDate(start_time, "start_time") : existing.start_time;
            const nextEnd = end_time ? parseIsoDate(end_time, "end_time") : existing.end_time;
            if (Date.parse(nextEnd) <= Date.parse(nextStart)) {
              throw new Error("end_time must be after start_time.");
            }

            const nextProjectId = project_id === undefined ? existing.project_id : project_id;
            const nextTaskId = task_id === undefined ? existing.task_id : task_id;
            const nextTagIds = tag_ids === undefined ? existing.tag_ids : [...new Set(tag_ids)];

            await validateEntryReferences(supabase, existing.workspace_id, {
              projectId: nextProjectId,
              taskId: nextTaskId,
              tagIds: nextTagIds,
            });

            const existingSegments = Array.isArray(existing.segments) ? existing.segments : [];
            const timesChanged = Boolean(start_time || end_time);
            const nextSegments =
              timesChanged && existingSegments.length <= 1
                ? [
                    {
                      id: existingSegments[0]?.id || uid("segment"),
                      type: "work",
                      start: nextStart,
                      end: nextEnd,
                    },
                  ]
                : existingSegments;

            const updates = {
              description: description ?? existing.description,
              start_time: nextStart,
              end_time: nextEnd,
              project_id: nextProjectId,
              task_id: nextTaskId,
              tag_ids: nextTagIds,
              notes: notes === undefined ? existing.notes : (notes?.trim() || null),
              segments: nextSegments,
            };

            const { data: updated, error: updateError } = await supabase
              .from("time_entries")
              .update(updates)
              .eq("id", id)
              .select("*")
              .single();

            if (updateError) throw new Error(updateError.message);

            await recordAuditEvent(supabase, {
              workspace_id: existing.workspace_id,
              actor_id: userId,
              action: existing.user_id !== userId ? "Admin corrected time entry" : "Updated time entry",
              target: updated.description || "Time entry",
              detail: "Entry values changed via MCP",
              reason: reason?.trim() || undefined,
              previous_value: JSON.stringify(existing),
              updated_value: JSON.stringify(updated),
            });

            return jsonContent(updated);
          },
        );

        server.registerTool(
          "start_timer",
          {
            description: "Start a timer in TimeFlow.",
            inputSchema: z.object({
              description: z.string().trim().min(1, "Description is required.").describe("What you are working on."),
              workspace_id: z.string().optional().describe("Workspace ID. Defaults to your active workspace."),
              project_id: z.string().optional().describe("Optional project ID."),
              task_id: z.string().optional().describe("Optional task ID."),
              tag_ids: z.array(z.string()).optional().default([]).describe("Optional list of tag IDs."),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false },
          },
          async ({ description, workspace_id, project_id, task_id, tag_ids }) => {
            const userId = await getAuthenticatedUserId(supabase);
            const resolvedWorkspaceId = await resolveWorkspaceId(supabase, userId, workspace_id);

            const { data: existing, error: existingError } = await supabase
              .from("active_timers")
              .select("id")
              .eq("user_id", userId)
              .or("status.eq.running,status.eq.paused")
              .maybeSingle();

            if (existingError) throw new Error(existingError.message);
            if (existing) throw new Error("A timer is already active. Stop it first.");

            await validateEntryReferences(supabase, resolvedWorkspaceId, {
              projectId: project_id,
              taskId: task_id,
              tagIds: tag_ids,
            });

            const nowIso = new Date().toISOString();
            const timer = {
              id: uid("timer"),
              workspace_id: resolvedWorkspaceId,
              user_id: userId,
              description,
              project_id: project_id || null,
              task_id: task_id || null,
              tag_ids: tag_ids || [],
              started_at: nowIso,
              status: "running",
              segments: [{ id: uid("segment"), type: "work", start: nowIso }],
            };

            const { data, error } = await supabase
              .from("active_timers")
              .insert(timer)
              .select("*")
              .single();

            if (error) throw new Error(error.message);
            return jsonContent(data);
          },
        );

        server.registerTool(
          "stop_timer",
          {
            description: "Stop the active timer (running or paused) and create a time entry from its work and break segments.",
            inputSchema: z.object({
              workspace_id: z.string().optional().describe("Workspace ID (optional)."),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false },
          },
          async () => {
            const userId = await getAuthenticatedUserId(supabase);

            const { data: timer, error: timerError } = await supabase
              .from("active_timers")
              .select("*")
              .eq("user_id", userId)
              .or("status.eq.running,status.eq.paused")
              .maybeSingle();

            if (timerError) throw new Error(timerError.message);
            if (!timer) throw new Error("No active timer found. Start a timer first.");

            const now = new Date().toISOString();
            let segs = Array.isArray(timer.segments) ? [...timer.segments] : [];
            if (segs.length === 0) {
              segs = [{ id: uid("segment"), type: "work", start: timer.started_at }];
            }
            const closedSegments = segs.map((s: { end?: string }) => (s.end ? s : { ...s, end: now }));

            const workMs = closedSegments
              .filter((s: { type: string }) => s.type === "work")
              .reduce(
                (sum: number, s: { start: string; end: string }) =>
                  sum + Math.max(0, Date.parse(s.end) - Date.parse(s.start)),
                0,
              );
            const durationSeconds = Math.floor(workMs / 1000);
            const durationMinutes = Math.floor(durationSeconds / 60);
            const durationHours = Math.floor(durationMinutes / 60);

            const entry = {
              id: uid("entry"),
              workspace_id: timer.workspace_id,
              user_id: userId,
              description: timer.description,
              project_id: timer.project_id,
              task_id: timer.task_id,
              tag_ids: timer.tag_ids,
              start_time: timer.started_at,
              end_time: now,
              source: "timer",
              segments: closedSegments,
            };

            const { error: entryError } = await supabase.from("time_entries").insert(entry);
            if (entryError) throw new Error(entryError.message);

            const { error: deleteError } = await supabase
              .from("active_timers")
              .delete()
              .eq("id", timer.id);
            if (deleteError) throw new Error(deleteError.message);

            return jsonContent({
              status: "stopped",
              entry,
              work_duration: {
                hours: durationHours,
                minutes: durationMinutes % 60,
                seconds: durationSeconds % 60,
              },
            });
          },
        );

        server.registerTool(
          "pause_timer",
          {
            description: "Pause or resume the active timer. Use action='pause' to pause, action='resume' to resume.",
            inputSchema: z.object({
              action: z.enum(["pause", "resume"]).describe("Action to perform."),
            }),
            annotations: { readOnlyHint: false, destructiveHint: false },
          },
          async ({ action }) => {
            const userId = await getAuthenticatedUserId(supabase);

            const { data: timer, error: timerError } = await supabase
              .from("active_timers")
              .select("*")
              .eq("user_id", userId)
              .or("status.eq.running,status.eq.paused")
              .maybeSingle();

            if (timerError) throw new Error(timerError.message);
            if (!timer) throw new Error("No active timer found. Start one first.");

            if (action === "pause" && timer.status !== "running") {
              throw new Error("Timer is not running.");
            }
            if (action === "resume" && timer.status !== "paused") {
              throw new Error("Timer is not paused.");
            }

            const now = new Date().toISOString();
            let segs = Array.isArray(timer.segments) ? [...timer.segments] : [];
            if (segs.length === 0) {
              segs = [{ id: uid("segment"), type: "work", start: timer.started_at }];
            }
            const closed = segs.map((s: { end?: string }) => (s.end ? s : { ...s, end: now }));
            const nextType = action === "pause" ? "break" : "work";
            const nextSegments = [...closed, { id: uid("segment"), type: nextType, start: now }];

            const newStatus = action === "pause" ? "paused" : "running";
            const { error: updateError } = await supabase
              .from("active_timers")
              .update({
                status: newStatus,
                paused_at: action === "pause" ? now : null,
                segments: nextSegments,
                updated_at: now,
              })
              .eq("id", timer.id);

            if (updateError) throw new Error(updateError.message);
            return jsonContent({ status: newStatus, timer_id: timer.id });
          },
        );

        server.registerTool(
          "delete_time_entry",
          {
            description: "Delete a time entry by ID.",
            inputSchema: z.object({
              id: z.string().min(1).describe("ID of the time entry to delete."),
            }),
            annotations: { readOnlyHint: false, destructiveHint: true },
          },
          async ({ id }) => {
            const userId = await getAuthenticatedUserId(supabase);

            const { data: existing, error: fetchError } = await supabase
              .from("time_entries")
              .select("id, workspace_id, description")
              .eq("id", id)
              .maybeSingle();

            if (fetchError) throw new Error(fetchError.message);
            if (!existing) {
              throw new Error(`Time entry "${id}" was not found or is not accessible.`);
            }

            const { error: deleteError } = await supabase
              .from("time_entries")
              .delete()
              .eq("id", id);

            if (deleteError) throw new Error(deleteError.message);

            await recordAuditEvent(supabase, {
              workspace_id: existing.workspace_id,
              actor_id: userId,
              action: "Deleted time entry",
              target: existing.description || "Time entry",
              detail: "Entry removed from the workspace via MCP",
            });

            return jsonContent({ deleted: true, id });
          },
        );



        return server;
      });

      return handler.fetch(req);
    },
  ),
);
