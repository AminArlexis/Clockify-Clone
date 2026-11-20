import { useEffect, useRef, useState } from "react";
import { Clock3 } from "lucide-react";
import { supabase } from "./lib/supabase";

type OAuthConsentDetails = {
  authorization_id: string;
  client: { name: string };
  user: { email: string };
  scope: string;
  redirect_uri: string;
};

export default function OAuthConsentScreen({
  authorizationId,
  onComplete,
}: {
  authorizationId: string;
  onComplete: () => void;
}) {
  const [details, setDetails] = useState<OAuthConsentDetails | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  useEffect(() => {
    let active = true;

    async function loadAuthorization() {
      if (!supabase) {
        if (active) {
          setError("Supabase is not configured. Add the project URL and anon key to .env.local.");
          setLoading(false);
        }
        return;
      }

      try {
        const { data, error: authorizationError } =
          await supabase.auth.oauth.getAuthorizationDetails(authorizationId);
        if (!active) return;
        if (authorizationError) throw authorizationError;
        if (!data) throw new Error("Supabase returned no OAuth authorization details.");

        if ("redirect_url" in data) {
          onComplete();
          window.location.assign(data.redirect_url);
          return;
        }

        if (active) setDetails(data);
      } catch (loadError: unknown) {
        if (active) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Could not load the OAuth authorization request.",
          );
        }
      } finally {
        if (active) setLoading(false);
      }
    }

    void loadAuthorization();
    return () => {
      active = false;
    };
  }, [authorizationId]);

  const respond = async (decision: "approve" | "deny") => {
    if (!supabase || submittingRef.current) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError("");

    try {
      const { data, error: consentError } =
        decision === "approve"
          ? await supabase.auth.oauth.approveAuthorization(authorizationId, {
              skipBrowserRedirect: true,
            })
          : await supabase.auth.oauth.denyAuthorization(authorizationId, {
              skipBrowserRedirect: true,
            });
      if (consentError) throw consentError;
      if (!data?.redirect_url) {
        throw new Error("Supabase did not return a URL for the OAuth response.");
      }
      onComplete();
      window.location.assign(data.redirect_url);
    } catch (consentError: unknown) {
      setError(
        consentError instanceof Error
          ? consentError.message
          : `Could not ${decision} the OAuth request.`,
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  const scopes = details?.scope.split(/\s+/).filter(Boolean) || [];

  return (
    <main className="auth-shell">
      <section className="auth-brand">
        <div className="brand-mark large">
          <Clock3 size={27} />
        </div>
        <div>
          <span className="eyebrow">TimeFlow security</span>
          <h1>Choose what you share.</h1>
          <p>Review each connection before allowing another app to access your account.</p>
        </div>
        <div className="auth-proof">
          <div>
            <strong>Private</strong>
            <span>Your choice is yours</span>
          </div>
          <div>
            <strong>Secure</strong>
            <span>OAuth protected</span>
          </div>
          <div>
            <strong>Clear</strong>
            <span>Scopes shown up front</span>
          </div>
        </div>
      </section>
      <section className="auth-panel">
        <div className="auth-form-wrap">
          <span className="eyebrow">OAuth authorization</span>
          <h2>{loading ? "Checking request..." : "Review access request"}</h2>
          {loading ? (
            <p className="muted" role="status">
              Loading the requesting app and its requested permissions.
            </p>
          ) : error && !details ? (
            <p className="form-error" role="alert">
              {error}
            </p>
          ) : details ? (
            <>
              <p className="muted">
                <strong>{details.client.name}</strong> is requesting access for{" "}
                <strong>{details.user.email}</strong>.
              </p>
              <section className="card" style={{ marginTop: 20, padding: 18 }}>
                <h3>Requested permissions</h3>
                <ul style={{ margin: "12px 0", paddingLeft: 20 }}>
                  {scopes.map((scope) => (
                    <li key={scope} style={{ marginBottom: 6 }}>
                      {scope}
                    </li>
                  ))}
                </ul>
                <p className="muted" style={{ overflowWrap: "anywhere" }}>
                  Redirect destination: {details.redirect_uri}
                </p>
              </section>
              {error && (
                <p className="form-error" role="alert" style={{ marginTop: 14 }}>
                  {error}
                </p>
              )}
              <div style={{ display: "flex", gap: 10, marginTop: 20 }}>
                <button
                  className="button button-secondary"
                  disabled={submitting}
                  onClick={() => void respond("deny")}
                >
                  Deny
                </button>
                <button
                  className="button button-primary"
                  disabled={submitting}
                  onClick={() => void respond("approve")}
                >
                  {submitting ? "Sending..." : "Approve access"}
                </button>
              </div>
              <p className="muted" style={{ marginTop: 14 }}>
                Only approve if you recognize and trust this app.
              </p>
            </>
          ) : (
            <p className="form-error" role="alert">
              The OAuth authorization request could not be displayed.
            </p>
          )}
        </div>
      </section>
    </main>
  );
}
