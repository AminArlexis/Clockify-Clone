-- Supabase Database Schema for Clockify Clone

-- Workspaces
CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Users / Profiles
CREATE TABLE IF NOT EXISTS profiles (
    id TEXT PRIMARY KEY,
    workspace_ids TEXT[] DEFAULT '{}',
    name TEXT NOT NULL,
    email TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'member',
    status TEXT NOT NULL DEFAULT 'active',
    joined_at TIMESTAMPTZ DEFAULT NOW(),
    avatar TEXT,
    timezone TEXT DEFAULT 'Asia/Manila',
    time_format TEXT DEFAULT '12h'
);

-- Projects
CREATE TABLE IF NOT EXISTS projects (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    client TEXT,
    description TEXT,
    color TEXT,
    status TEXT DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tasks
CREATE TABLE IF NOT EXISTS tasks (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    assignee_id TEXT REFERENCES profiles(id) ON DELETE SET NULL,
    completed BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Tags
CREATE TABLE IF NOT EXISTS tags (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    color TEXT,
    archived BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Time Entries
CREATE TABLE IF NOT EXISTS time_entries (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
    description TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    tag_ids TEXT[] DEFAULT '{}',
    start_time TIMESTAMPTZ NOT NULL,
    end_time TIMESTAMPTZ NOT NULL,
    source TEXT DEFAULT 'timer',
    segments JSONB DEFAULT '[]'::jsonb,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Active Timers
CREATE TABLE IF NOT EXISTS active_timers (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
    description TEXT,
    project_id TEXT REFERENCES projects(id) ON DELETE SET NULL,
    task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL,
    tag_ids TEXT[] DEFAULT '{}',
    started_at TIMESTAMPTZ NOT NULL,
    status TEXT DEFAULT 'running',
    segments JSONB DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Audit Events
CREATE TABLE IF NOT EXISTS audit_events (
    id TEXT PRIMARY KEY,
    workspace_id TEXT REFERENCES workspaces(id) ON DELETE CASCADE,
    actor_id TEXT REFERENCES profiles(id) ON DELETE CASCADE,
    action TEXT NOT NULL,
    target TEXT NOT NULL,
    detail TEXT NOT NULL,
    reason TEXT,
    previous_value TEXT,
    updated_value TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable Row Level Security (Optional: customize policies for your team)
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE active_timers ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_events ENABLE ROW LEVEL SECURITY;

-- Grant access on all tables to anon and authenticated roles
GRANT ALL ON TABLE workspaces TO anon, authenticated, service_role;
GRANT ALL ON TABLE profiles TO anon, authenticated, service_role;
GRANT ALL ON TABLE projects TO anon, authenticated, service_role;
GRANT ALL ON TABLE tasks TO anon, authenticated, service_role;
GRANT ALL ON TABLE tags TO anon, authenticated, service_role;
GRANT ALL ON TABLE time_entries TO anon, authenticated, service_role;
GRANT ALL ON TABLE active_timers TO anon, authenticated, service_role;
GRANT ALL ON TABLE audit_events TO anon, authenticated, service_role;

-- Allow public access with anon key for demo / development purposes:
DROP POLICY IF EXISTS "Public read/write access for workspaces" ON workspaces;
DROP POLICY IF EXISTS "Public read/write access for profiles" ON profiles;
DROP POLICY IF EXISTS "Public read/write access for projects" ON projects;
DROP POLICY IF EXISTS "Public read/write access for tasks" ON tasks;
DROP POLICY IF EXISTS "Public read/write access for tags" ON tags;
DROP POLICY IF EXISTS "Public read/write access for time_entries" ON time_entries;
DROP POLICY IF EXISTS "Public read/write access for active_timers" ON active_timers;
DROP POLICY IF EXISTS "Public read/write access for audit_events" ON audit_events;

CREATE POLICY "Public read/write access for workspaces" ON workspaces FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access for profiles" ON profiles FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access for projects" ON projects FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access for tasks" ON tasks FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access for tags" ON tags FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access for time_entries" ON time_entries FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access for active_timers" ON active_timers FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Public read/write access for audit_events" ON audit_events FOR ALL USING (true) WITH CHECK (true);

