# TimeFlow

TimeFlow is a React time-tracking application backed by Supabase Auth and Postgres.

## Setup

Create `.env.local` at the project root:

```dotenv
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_PUBLISHABLE_OR_ANON_KEY
```

The app does not contain a hardcoded project URL, key, or sample-data fallback. Do not put a service-role key in browser code. Before using the app, run the complete `supabase_schema.sql` script in the Supabase SQL editor; it creates the schema, membership RPCs, and Row Level Security policies.

### Email invitations

The Team page sends invitations through the `invite-workspace-member` Supabase Edge Function and Brevo. Deploy it with the Supabase CLI after linking the project:

```bash
supabase functions deploy invite-workspace-member
```

In Supabase **Project Settings → Edge Functions → Secrets**, set `BREVO_API_KEY`, `BREVO_SENDER_EMAIL` (a verified Brevo sender), and `APP_BASE_URL` (the deployed app URL). Supabase provides `SUPABASE_URL` and `SUPABASE_ANON_KEY` to the function. Keep the Brevo key in Edge Function secrets; never put it in `.env.local` or browser code. The function uses the signed-in user's token and the database RPC to enforce workspace-admin access; it does not need a service-role key.

Install dependencies and run the development server:

```bash
pnpm install
pnpm dev
```

Build and test:

```bash
pnpm build
pnpm test:run
```

## Authentication and data

- `/register` creates a Supabase Auth account. After email verification, the registration RPC claims matching pending workspace invitations or creates a new workspace with the creator as its admin.
- `/login`, `/forgot`, and `/reset` use Supabase Auth.
- `workspace_members` is the authoritative source for workspace access and per-workspace admin/member roles. `profiles.workspace_ids` is retained only for compatibility.
- Workspaces, profiles, projects, tasks, tags, time entries, active timers, and audit events are read from their Supabase tables.
- Changes are written to Supabase, and sync errors are shown in the app.
- Admins can email workspace invitations through Brevo and choose a role. Invitees must register or sign in with the invited email address; the app then claims the invitation.
- Members can manage their own time, while workspace admins can manage members and correct workspace time entries. RLS enforces workspace boundaries and audit events cannot be updated or deleted by the app.
- App records are not cached in browser `localStorage`; legacy prototype cache/session keys are removed.
- A new Supabase project starts empty. No demo users or records are seeded.
- Test-only fixtures are in `src/test/fixtures.ts`.

Client-side workspace filtering is not the security boundary; the supplied RLS policies and security-definer RPCs enforce access on the server. Never add unrestricted public read/write policies or grant broad table access to `anon`.
