import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, x-client-info, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (body: Record<string, string>, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (character) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return replacements[character];
  });

Deno.serve(async (request) => {
  if (request.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }

  const authorization = request.headers.get("Authorization");
  if (!authorization?.startsWith("Bearer ")) {
    return jsonResponse({ error: "You must be signed in to send an invitation." }, 401);
  }

  let payload: { workspaceId?: unknown; email?: unknown; role?: unknown };
  try {
    payload = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request body." }, 400);
  }

  const workspaceId = typeof payload.workspaceId === "string" ? payload.workspaceId.trim() : "";
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const role = payload.role === "admin" ? "admin" : payload.role === "member" ? "member" : "";
  if (!workspaceId || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !role) {
    return jsonResponse({ error: "Enter a valid workspace, email address, and role." }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const brevoApiKey = Deno.env.get("BREVO_API_KEY");
  const brevoSenderEmail = Deno.env.get("BREVO_SENDER_EMAIL");
  const appBaseUrl = Deno.env.get("APP_BASE_URL");
  if (!supabaseUrl || !supabaseAnonKey || !brevoApiKey || !brevoSenderEmail || !appBaseUrl) {
    console.error("Invite email function is missing required Supabase or Brevo configuration.");
    return jsonResponse({ error: "Invitation email is not configured on the server." }, 500);
  }

  let registerUrl: URL;
  try {
    registerUrl = new URL("/register", appBaseUrl);
    if (registerUrl.protocol !== "https:" && registerUrl.protocol !== "http:") {
      throw new Error("Invalid app URL protocol.");
    }
  } catch {
    return jsonResponse({ error: "The app registration URL is not configured correctly." }, 500);
  }

  const accessToken = authorization.slice("Bearer ".length);
  const userClient = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: { headers: { Authorization: authorization } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return jsonResponse({ error: "Your session is invalid or has expired. Please sign in again." }, 401);
  }

  const { data: workspace, error: workspaceError } = await userClient
    .from("workspaces")
    .select("name")
    .eq("id", workspaceId)
    .maybeSingle();
  if (workspaceError || !workspace) {
    return jsonResponse({ error: "Workspace not found or you do not have access to it." }, 404);
  }

  const { error: inviteError } = await userClient.rpc("invite_workspace_member", {
    p_workspace_id: workspaceId,
    p_email: email,
    p_role: role,
  });
  if (inviteError) {
    return jsonResponse({ error: inviteError.message }, 403);
  }

  const workspaceName = String(workspace.name || "your workspace");
  const safeWorkspaceName = escapeHtml(workspaceName);
  const safeEmail = escapeHtml(email);
  const safeRole = escapeHtml(role);
  const registrationLink = registerUrl.toString();
  const brevoResponse = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": brevoApiKey,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      sender: { email: brevoSenderEmail, name: "TimeFlow" },
      to: [{ email }],
      subject: `You're invited to join ${workspaceName} on TimeFlow`,
      htmlContent: `
        <div style="font-family:Arial,sans-serif;line-height:1.6;color:#20242c;max-width:560px;margin:0 auto">
          <h1 style="font-size:24px">You're invited to TimeFlow</h1>
          <p>You've been invited to join <strong>${safeWorkspaceName}</strong> as a <strong>${safeRole}</strong>.</p>
          <p>Create your account using <strong>${safeEmail}</strong> to accept this invitation.</p>
          <p><a href="${escapeHtml(registrationLink)}" style="display:inline-block;background:#5068e9;color:#fff;padding:12px 20px;border-radius:6px;text-decoration:none">Create your account</a></p>
          <p>If you already have a TimeFlow account, sign in with this email address to join the workspace.</p>
        </div>
      `,
      textContent: [
        `You've been invited to join ${workspaceName} on TimeFlow as a ${role}.`,
        `Create your account using ${email} to accept the invitation: ${registrationLink}`,
        "If you already have an account, sign in with this email address to join the workspace.",
      ].join("\n\n"),
    }),
  });

  if (!brevoResponse.ok) {
    console.error(`Brevo invite email request failed with status ${brevoResponse.status}.`);
    return jsonResponse({ error: "The invitation was saved, but Brevo could not send the email." }, 502);
  }

  return jsonResponse({ message: "Invitation email sent." });
});
