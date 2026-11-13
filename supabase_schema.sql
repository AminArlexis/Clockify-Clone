-- Run in the Supabase SQL editor. This migration keeps workspace membership
-- and roles on the server; the anon key is never an authorization boundary.

CREATE TABLE IF NOT EXISTS public.workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.workspaces
    ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.profiles (
    id TEXT PRIMARY KEY,
    workspace_ids TEXT[] NOT NULL DEFAULT '{}',
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active',
    joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    avatar TEXT,
    timezone TEXT NOT NULL DEFAULT 'Asia/Manila',
    time_format TEXT NOT NULL DEFAULT '12h'
);

CREATE TABLE IF NOT EXISTS public.projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    client TEXT,
    description TEXT,
    color TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    project_id TEXT NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    assignee_id TEXT REFERENCES public.profiles(id) ON DELETE SET NULL,
    completed BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.tags (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    archived BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.time_entries (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    description TEXT,
    project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES public.tasks(id) ON DELETE SET NULL,
    tag_ids TEXT[] NOT NULL DEFAULT '{}',
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    source TEXT NOT NULL DEFAULT 'timer',
    segments JSONB NOT NULL DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.active_timers (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    description TEXT,
    project_id TEXT REFERENCES public.projects(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES public.tasks(id) ON DELETE SET NULL,
    tag_ids TEXT[] NOT NULL DEFAULT '{}',
    started_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    segments JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS active_timers_user_key
    ON public.active_timers(user_id);

CREATE TABLE IF NOT EXISTS public.audit_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    actor_id TEXT NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT NOT NULL,
    reason TEXT,
    previous_value TEXT,
    updated_value TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.workspace_members (
    workspace_id TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.workspace_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id TEXT NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'member')),
    invited_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    accepted_at TIMESTAMPTZ,
    UNIQUE (workspace_id, email),
    CHECK (email = LOWER(BTRIM(email)))
);

-- Migrate legacy profile workspace references into the authoritative table.
INSERT INTO public.workspace_members (workspace_id, user_id, role, status, created_at)
SELECT
    workspace_id,
    profile.id::UUID,
    CASE WHEN profile.role = 'admin' THEN 'admin' ELSE 'member' END,
    CASE WHEN profile.status = 'inactive' THEN 'inactive' ELSE 'active' END,
    COALESCE(profile.joined_at, NOW())
FROM public.profiles AS profile
CROSS JOIN LATERAL UNNEST(COALESCE(profile.workspace_ids, '{}')) AS membership(workspace_id)
JOIN public.workspaces AS workspace ON workspace.id = membership.workspace_id
WHERE profile.id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  AND profile.status <> 'invited'
ON CONFLICT (workspace_id, user_id) DO NOTHING;

UPDATE public.workspaces AS workspace
SET created_by = membership.user_id
FROM public.workspace_members AS membership
WHERE membership.workspace_id = workspace.id
  AND membership.role = 'admin'
  AND workspace.created_by IS NULL;

CREATE OR REPLACE FUNCTION public.is_workspace_member(target_workspace_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members AS membership
        WHERE membership.workspace_id = target_workspace_id
          AND membership.user_id = auth.uid()
          AND membership.status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_admin(target_workspace_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT EXISTS (
        SELECT 1
        FROM public.workspace_members AS membership
        WHERE membership.workspace_id = target_workspace_id
          AND membership.user_id = auth.uid()
          AND membership.role = 'admin'
          AND membership.status = 'active'
    );
$$;

CREATE OR REPLACE FUNCTION public.can_read_profile(target_profile_id TEXT)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
    SELECT target_profile_id = auth.uid()::TEXT
        OR EXISTS (
            SELECT 1
            FROM public.workspace_members AS viewer
            JOIN public.workspace_members AS target
              ON target.workspace_id = viewer.workspace_id
            WHERE viewer.user_id = auth.uid()
              AND viewer.status = 'active'
              AND target.user_id::TEXT = target_profile_id
        );
$$;

DROP FUNCTION IF EXISTS public.claim_workspace_invites();

CREATE FUNCTION public.claim_workspace_invites()
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_email TEXT;
    v_workspace_ids TEXT[];
    v_primary_role TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    SELECT LOWER(BTRIM(auth_user.email))
    INTO v_email
    FROM auth.users AS auth_user
    WHERE auth_user.id = v_user_id;

    IF v_email IS NULL THEN
        RAISE EXCEPTION 'An email address is required to claim an invitation.';
    END IF;

    INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
    SELECT invite.workspace_id, v_user_id, invite.role, 'active'
    FROM public.workspace_invites AS invite
    WHERE invite.email = v_email
      AND invite.accepted_at IS NULL
    ON CONFLICT (workspace_id, user_id) DO UPDATE
    SET role = EXCLUDED.role, status = 'active';

    UPDATE public.workspace_invites AS invite
    SET accepted_at = NOW()
    WHERE invite.email = v_email
      AND invite.accepted_at IS NULL;

    SELECT ARRAY_AGG(membership.workspace_id ORDER BY membership.created_at, membership.workspace_id)
    INTO v_workspace_ids
    FROM public.workspace_members AS membership
    WHERE membership.user_id = v_user_id
      AND membership.status = 'active';

    SELECT membership.role
    INTO v_primary_role
    FROM public.workspace_members AS membership
    WHERE membership.user_id = v_user_id
      AND membership.status = 'active'
    ORDER BY membership.created_at, membership.workspace_id
    LIMIT 1;

    UPDATE public.profiles AS profile
    SET workspace_ids = COALESCE(v_workspace_ids, '{}'),
        role = COALESCE(v_primary_role, profile.role),
        status = CASE WHEN COALESCE(v_workspace_ids, '{}') = '{}' THEN 'inactive' ELSE 'active' END
    WHERE profile.id = v_user_id::TEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.register_workspace_account(
    p_workspace_id TEXT,
    p_workspace_name TEXT,
    p_full_name TEXT,
    p_avatar TEXT,
    p_timezone TEXT,
    p_time_format TEXT
)
RETURNS TABLE (workspace_id TEXT, role TEXT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_user_id UUID := auth.uid();
    v_email TEXT;
    v_workspace_ids TEXT[];
    v_primary_workspace_id TEXT;
    v_primary_role TEXT;
BEGIN
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;

    SELECT LOWER(BTRIM(auth_user.email))
    INTO v_email
    FROM auth.users AS auth_user
    WHERE auth_user.id = v_user_id;

    IF v_email IS NULL OR BTRIM(COALESCE(p_full_name, '')) = '' THEN
        RAISE EXCEPTION 'A verified email and full name are required.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.workspace_invites AS invite
        WHERE invite.email = v_email
          AND invite.accepted_at IS NULL
    ) THEN
        INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
        SELECT invite.workspace_id, v_user_id, invite.role, 'active'
        FROM public.workspace_invites AS invite
        WHERE invite.email = v_email
          AND invite.accepted_at IS NULL
        ON CONFLICT (workspace_id, user_id) DO UPDATE
        SET role = EXCLUDED.role, status = 'active';

        UPDATE public.workspace_invites AS invite
        SET accepted_at = NOW()
        WHERE invite.email = v_email
          AND invite.accepted_at IS NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1
        FROM public.workspace_members AS membership
        WHERE membership.user_id = v_user_id
          AND membership.status = 'active'
    ) THEN
        IF EXISTS (
            SELECT 1
            FROM public.workspace_members AS membership
            WHERE membership.user_id = v_user_id
        ) THEN
            RAISE EXCEPTION 'Workspace access is inactive. Ask a workspace admin to reactivate it.';
        END IF;

        IF BTRIM(COALESCE(p_workspace_id, '')) = ''
           OR BTRIM(COALESCE(p_workspace_name, '')) = '' THEN
            RAISE EXCEPTION 'A workspace name is required.';
        END IF;

        INSERT INTO public.workspaces (id, name, created_by)
        VALUES (p_workspace_id, BTRIM(p_workspace_name), v_user_id);

        INSERT INTO public.workspace_members (workspace_id, user_id, role, status)
        VALUES (p_workspace_id, v_user_id, 'admin', 'active');
    END IF;

    SELECT ARRAY_AGG(membership.workspace_id ORDER BY membership.created_at, membership.workspace_id)
    INTO v_workspace_ids
    FROM public.workspace_members AS membership
    WHERE membership.user_id = v_user_id
      AND membership.status = 'active';

    SELECT membership.workspace_id, membership.role
    INTO v_primary_workspace_id, v_primary_role
    FROM public.workspace_members AS membership
    WHERE membership.user_id = v_user_id
      AND membership.status = 'active'
    ORDER BY membership.created_at, membership.workspace_id
    LIMIT 1;

    INSERT INTO public.profiles (
        id, workspace_ids, name, email, role, status, joined_at, avatar, timezone, time_format
    )
    VALUES (
        v_user_id::TEXT,
        COALESCE(v_workspace_ids, '{}'),
        BTRIM(p_full_name),
        v_email,
        COALESCE(v_primary_role, 'member'),
        'active',
        NOW(),
        NULLIF(p_avatar, ''),
        COALESCE(NULLIF(p_timezone, ''), 'UTC'),
        CASE WHEN p_time_format = '24h' THEN '24h' ELSE '12h' END
    )
    ON CONFLICT (id) DO UPDATE
    SET workspace_ids = EXCLUDED.workspace_ids,
        name = EXCLUDED.name,
        email = EXCLUDED.email,
        role = EXCLUDED.role,
        status = 'active',
        avatar = EXCLUDED.avatar,
        timezone = EXCLUDED.timezone,
        time_format = EXCLUDED.time_format;

    RETURN QUERY
    SELECT membership.workspace_id, membership.role
    FROM public.workspace_members AS membership
    WHERE membership.user_id = v_user_id
      AND membership.status = 'active'
    ORDER BY membership.created_at, membership.workspace_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_workspace_member(
    p_workspace_id TEXT,
    p_email TEXT,
    p_role TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_email TEXT := LOWER(BTRIM(COALESCE(p_email, '')));
BEGIN
    IF NOT public.is_workspace_admin(p_workspace_id) THEN
        RAISE EXCEPTION 'Only workspace admins can invite members.';
    END IF;
    IF POSITION('@' IN v_email) < 2 OR POSITION('.' IN SPLIT_PART(v_email, '@', 2)) < 2 THEN
        RAISE EXCEPTION 'Enter a valid email address.';
    END IF;
    IF p_role IS NULL OR p_role NOT IN ('admin', 'member') THEN
        RAISE EXCEPTION 'Invalid workspace role.';
    END IF;
    IF EXISTS (
        SELECT 1
        FROM public.workspace_members AS membership
        JOIN public.profiles AS profile ON profile.id = membership.user_id::TEXT
        WHERE membership.workspace_id = p_workspace_id
          AND LOWER(profile.email) = v_email
          AND membership.status = 'active'
    ) THEN
        RAISE EXCEPTION 'This person is already an active workspace member.';
    END IF;

    INSERT INTO public.workspace_invites (workspace_id, email, role, invited_by, created_at, accepted_at)
    VALUES (p_workspace_id, v_email, p_role, auth.uid(), NOW(), NULL)
    ON CONFLICT (workspace_id, email) DO UPDATE
    SET role = EXCLUDED.role,
        invited_by = EXCLUDED.invited_by,
        created_at = NOW(),
        accepted_at = NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_workspace_member(
    p_workspace_id TEXT,
    p_user_id UUID,
    p_role TEXT,
    p_status TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
    v_owner_id UUID;
BEGIN
    IF NOT public.is_workspace_admin(p_workspace_id) THEN
        RAISE EXCEPTION 'Only workspace admins can manage members.';
    END IF;
    IF p_role IS NULL OR p_role NOT IN ('admin', 'member')
       OR p_status IS NULL OR p_status NOT IN ('active', 'inactive') THEN
        RAISE EXCEPTION 'Invalid role or member status.';
    END IF;

    SELECT workspace.created_by
    INTO v_owner_id
    FROM public.workspaces AS workspace
    WHERE workspace.id = p_workspace_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workspace not found.';
    END IF;
    IF p_user_id = v_owner_id AND (p_role <> 'admin' OR p_status <> 'active') THEN
        RAISE EXCEPTION 'The workspace owner must remain an active admin.';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM public.workspace_members AS target
        WHERE target.workspace_id = p_workspace_id
          AND target.user_id = p_user_id
          AND target.role = 'admin'
          AND target.status = 'active'
    )
    AND (p_role <> 'admin' OR p_status <> 'active')
    AND (
        SELECT COUNT(*)
        FROM public.workspace_members AS admins
        WHERE admins.workspace_id = p_workspace_id
          AND admins.role = 'admin'
          AND admins.status = 'active'
    ) <= 1 THEN
        RAISE EXCEPTION 'A workspace must keep at least one active admin.';
    END IF;

    UPDATE public.workspace_members AS membership
    SET role = p_role, status = p_status
    WHERE membership.workspace_id = p_workspace_id
      AND membership.user_id = p_user_id;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Workspace member not found.';
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_my_profile(
    p_full_name TEXT,
    p_avatar TEXT,
    p_timezone TEXT,
    p_time_format TEXT
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION 'Authentication is required.';
    END IF;
    IF BTRIM(COALESCE(p_full_name, '')) = '' THEN
        RAISE EXCEPTION 'A full name is required.';
    END IF;

    UPDATE public.profiles AS profile
    SET name = BTRIM(p_full_name),
        avatar = NULLIF(p_avatar, ''),
        timezone = COALESCE(NULLIF(p_timezone, ''), 'UTC'),
        time_format = CASE WHEN p_time_format = '24h' THEN '24h' ELSE '12h' END
    WHERE profile.id = auth.uid()::TEXT;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Profile not found.';
    END IF;
END;
$$;

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.active_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_invites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public read/write access for workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Public read/write access for profiles" ON public.profiles;
DROP POLICY IF EXISTS "Public read/write access for projects" ON public.projects;
DROP POLICY IF EXISTS "Public read/write access for tasks" ON public.tasks;
DROP POLICY IF EXISTS "Public read/write access for tags" ON public.tags;
DROP POLICY IF EXISTS "Public read/write access for time_entries" ON public.time_entries;
DROP POLICY IF EXISTS "Public read/write access for active_timers" ON public.active_timers;
DROP POLICY IF EXISTS "Public read/write access for audit_events" ON public.audit_events;

DROP POLICY IF EXISTS "workspace members can read workspaces" ON public.workspaces;
CREATE POLICY "workspace members can read workspaces"
    ON public.workspaces FOR SELECT TO authenticated
    USING (public.is_workspace_member(id));

DROP POLICY IF EXISTS "workspace members can read profiles" ON public.profiles;
CREATE POLICY "workspace members can read profiles"
    ON public.profiles FOR SELECT TO authenticated
    USING (public.can_read_profile(id));

DROP POLICY IF EXISTS "workspace members can read memberships" ON public.workspace_members;
CREATE POLICY "workspace members can read memberships"
    ON public.workspace_members FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id) OR user_id = auth.uid());

DROP POLICY IF EXISTS "workspace admins can read invites" ON public.workspace_invites;
CREATE POLICY "workspace admins can read invites"
    ON public.workspace_invites FOR SELECT TO authenticated
    USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "workspace members can read projects" ON public.projects;
CREATE POLICY "workspace members can read projects"
    ON public.projects FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "workspace admins can insert projects" ON public.projects;
CREATE POLICY "workspace admins can insert projects"
    ON public.projects FOR INSERT TO authenticated
    WITH CHECK (public.is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS "workspace admins can update projects" ON public.projects;
CREATE POLICY "workspace admins can update projects"
    ON public.projects FOR UPDATE TO authenticated
    USING (public.is_workspace_admin(workspace_id))
    WITH CHECK (public.is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS "workspace admins can delete projects" ON public.projects;
CREATE POLICY "workspace admins can delete projects"
    ON public.projects FOR DELETE TO authenticated
    USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "workspace members can read tasks" ON public.tasks;
CREATE POLICY "workspace members can read tasks"
    ON public.tasks FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "workspace admins can insert tasks" ON public.tasks;
CREATE POLICY "workspace admins can insert tasks"
    ON public.tasks FOR INSERT TO authenticated
    WITH CHECK (public.is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS "workspace admins can update tasks" ON public.tasks;
CREATE POLICY "workspace admins can update tasks"
    ON public.tasks FOR UPDATE TO authenticated
    USING (public.is_workspace_admin(workspace_id))
    WITH CHECK (public.is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS "workspace admins can delete tasks" ON public.tasks;
CREATE POLICY "workspace admins can delete tasks"
    ON public.tasks FOR DELETE TO authenticated
    USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "workspace members can read tags" ON public.tags;
CREATE POLICY "workspace members can read tags"
    ON public.tags FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "workspace admins can insert tags" ON public.tags;
CREATE POLICY "workspace admins can insert tags"
    ON public.tags FOR INSERT TO authenticated
    WITH CHECK (public.is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS "workspace admins can update tags" ON public.tags;
CREATE POLICY "workspace admins can update tags"
    ON public.tags FOR UPDATE TO authenticated
    USING (public.is_workspace_admin(workspace_id))
    WITH CHECK (public.is_workspace_admin(workspace_id));
DROP POLICY IF EXISTS "workspace admins can delete tags" ON public.tags;
CREATE POLICY "workspace admins can delete tags"
    ON public.tags FOR DELETE TO authenticated
    USING (public.is_workspace_admin(workspace_id));

DROP POLICY IF EXISTS "members can read own entries and admins all entries" ON public.time_entries;
CREATE POLICY "members can read own entries and admins all entries"
    ON public.time_entries FOR SELECT TO authenticated
    USING (
        public.is_workspace_member(workspace_id)
        AND (user_id = auth.uid()::TEXT OR public.is_workspace_admin(workspace_id))
    );
DROP POLICY IF EXISTS "members can create own entries" ON public.time_entries;
CREATE POLICY "members can create own entries"
    ON public.time_entries FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid()::TEXT AND public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "members and admins can update entries" ON public.time_entries;
CREATE POLICY "members and admins can update entries"
    ON public.time_entries FOR UPDATE TO authenticated
    USING (
        public.is_workspace_member(workspace_id)
        AND (user_id = auth.uid()::TEXT OR public.is_workspace_admin(workspace_id))
    )
    WITH CHECK (
        public.is_workspace_member(workspace_id)
        AND (user_id = auth.uid()::TEXT OR public.is_workspace_admin(workspace_id))
    );
DROP POLICY IF EXISTS "members and admins can delete entries" ON public.time_entries;
CREATE POLICY "members and admins can delete entries"
    ON public.time_entries FOR DELETE TO authenticated
    USING (
        public.is_workspace_member(workspace_id)
        AND (user_id = auth.uid()::TEXT OR public.is_workspace_admin(workspace_id))
    );

DROP POLICY IF EXISTS "users can read own active timers" ON public.active_timers;
CREATE POLICY "users can read own active timers"
    ON public.active_timers FOR SELECT TO authenticated
    USING (user_id = auth.uid()::TEXT AND public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "users can create own active timers" ON public.active_timers;
CREATE POLICY "users can create own active timers"
    ON public.active_timers FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid()::TEXT AND public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "users can update own active timers" ON public.active_timers;
CREATE POLICY "users can update own active timers"
    ON public.active_timers FOR UPDATE TO authenticated
    USING (user_id = auth.uid()::TEXT AND public.is_workspace_member(workspace_id))
    WITH CHECK (user_id = auth.uid()::TEXT AND public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "users can delete own active timers" ON public.active_timers;
CREATE POLICY "users can delete own active timers"
    ON public.active_timers FOR DELETE TO authenticated
    USING (user_id = auth.uid()::TEXT AND public.is_workspace_member(workspace_id));

DROP POLICY IF EXISTS "workspace members can read audit events" ON public.audit_events;
CREATE POLICY "workspace members can read audit events"
    ON public.audit_events FOR SELECT TO authenticated
    USING (public.is_workspace_member(workspace_id));
DROP POLICY IF EXISTS "members can add audit events" ON public.audit_events;
CREATE POLICY "members can add audit events"
    ON public.audit_events FOR INSERT TO authenticated
    WITH CHECK (actor_id = auth.uid()::TEXT AND public.is_workspace_member(workspace_id));

REVOKE ALL ON TABLE
    public.workspaces,
    public.profiles,
    public.projects,
    public.tasks,
    public.tags,
    public.time_entries,
    public.active_timers,
    public.audit_events,
    public.workspace_members,
    public.workspace_invites
FROM anon, authenticated;

GRANT SELECT ON TABLE
    public.workspaces,
    public.profiles,
    public.workspace_members,
    public.workspace_invites,
    public.projects,
    public.tasks,
    public.tags,
    public.time_entries,
    public.active_timers,
    public.audit_events
TO authenticated;

GRANT INSERT, UPDATE, DELETE ON TABLE
    public.projects,
    public.tasks,
    public.tags,
    public.time_entries,
    public.active_timers
TO authenticated;

GRANT INSERT ON TABLE public.audit_events TO authenticated;

REVOKE ALL ON FUNCTION public.is_workspace_member(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.is_workspace_admin(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.can_read_profile(TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.claim_workspace_invites() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.register_workspace_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.invite_workspace_member(TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_workspace_member(TEXT, UUID, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.update_my_profile(TEXT, TEXT, TEXT, TEXT) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.is_workspace_member(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_admin(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_read_profile(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.claim_workspace_invites() TO authenticated;
GRANT EXECUTE ON FUNCTION public.register_workspace_account(TEXT, TEXT, TEXT, TEXT, TEXT, TEXT)
    TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_workspace_member(TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_workspace_member(TEXT, UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_my_profile(TEXT, TEXT, TEXT, TEXT) TO authenticated;
