import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import OAuthConsentScreen from "./OAuthConsentScreen";

const oauthMocks = vi.hoisted(() => ({
  getAuthorizationDetails: vi.fn(),
  approveAuthorization: vi.fn(),
  denyAuthorization: vi.fn(),
}));

vi.mock("./lib/supabase", () => ({
  supabase: { auth: { oauth: oauthMocks } },
}));

const authorizationDetails = {
  authorization_id: "auth-request-123",
  client: { name: "Hermes Agent", uri: "https://hermes.example", logo_uri: "" },
  user: { id: "user-123", email: "person@example.com" },
  scope: "openid profile email",
  redirect_uri: "https://hermes.example/callback",
};

const redirectUrl = "https://hermes.example/callback?code=returned-code&state=returned-state";

describe("OAuth consent screen", () => {
  let browserRedirect: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    oauthMocks.getAuthorizationDetails.mockReset().mockResolvedValue({
      data: authorizationDetails,
      error: null,
    });
    oauthMocks.approveAuthorization.mockReset();
    oauthMocks.denyAuthorization.mockReset();

    browserRedirect = vi.fn();
    const browserWindow = window;
    vi.stubGlobal(
      "window",
      new Proxy(browserWindow, {
        get(target, property) {
          if (property === "location") return { assign: browserRedirect };
          const value = Reflect.get(target, property, target);
          return typeof value === "function" ? value.bind(target) : value;
        },
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows the requesting client and scopes before the user decides", async () => {
    render(<OAuthConsentScreen authorizationId="auth-request-123" onComplete={vi.fn()} />);

    expect(await screen.findByText("Hermes Agent")).toBeInTheDocument();
    expect(screen.getByText("person@example.com")).toBeInTheDocument();
    expect(screen.getByText("openid")).toBeInTheDocument();
    expect(screen.getByText("profile")).toBeInTheDocument();
    expect(screen.getByText("email", { exact: true })).toBeInTheDocument();
    expect(oauthMocks.getAuthorizationDetails).toHaveBeenCalledWith("auth-request-123");
  });

  it("submits explicit approval and reports Supabase errors", async () => {
    oauthMocks.approveAuthorization.mockResolvedValue({
      data: null,
      error: new Error("Approval failed"),
    });
    render(<OAuthConsentScreen authorizationId="auth-request-123" onComplete={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve access" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Approval failed"));
    expect(oauthMocks.approveAuthorization).toHaveBeenCalledWith("auth-request-123", {
      skipBrowserRedirect: true,
    });
  });

  it("submits denial without approving the request", async () => {
    oauthMocks.denyAuthorization.mockResolvedValue({
      data: null,
      error: new Error("Denial failed"),
    });
    render(<OAuthConsentScreen authorizationId="auth-request-123" onComplete={vi.fn()} />);

    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));

    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Denial failed"));
    expect(oauthMocks.denyAuthorization).toHaveBeenCalledWith("auth-request-123", {
      skipBrowserRedirect: true,
    });
    expect(oauthMocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it("redirects to the exact approval URL after completing the request", async () => {
    const events: string[] = [];
    const onComplete = vi.fn(() => events.push("complete"));
    browserRedirect.mockImplementation((url: string) => events.push(`redirect:${url}`));
    oauthMocks.approveAuthorization.mockResolvedValue({
      data: { redirect_url: redirectUrl },
      error: null,
    });
    render(<OAuthConsentScreen authorizationId="auth-request-123" onComplete={onComplete} />);

    fireEvent.click(await screen.findByRole("button", { name: "Approve access" }));

    await waitFor(() => expect(browserRedirect).toHaveBeenCalledWith(redirectUrl));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(events).toEqual(["complete", `redirect:${redirectUrl}`]);
    expect(oauthMocks.approveAuthorization).toHaveBeenCalledWith("auth-request-123", {
      skipBrowserRedirect: true,
    });
  });

  it("redirects to the exact denial URL after completing the request", async () => {
    const events: string[] = [];
    const onComplete = vi.fn(() => events.push("complete"));
    browserRedirect.mockImplementation((url: string) => events.push(`redirect:${url}`));
    oauthMocks.denyAuthorization.mockResolvedValue({
      data: { redirect_url: redirectUrl },
      error: null,
    });
    render(<OAuthConsentScreen authorizationId="auth-request-123" onComplete={onComplete} />);

    fireEvent.click(await screen.findByRole("button", { name: "Deny" }));

    await waitFor(() => expect(browserRedirect).toHaveBeenCalledWith(redirectUrl));
    expect(onComplete).toHaveBeenCalledOnce();
    expect(events).toEqual(["complete", `redirect:${redirectUrl}`]);
    expect(oauthMocks.denyAuthorization).toHaveBeenCalledWith("auth-request-123", {
      skipBrowserRedirect: true,
    });
    expect(oauthMocks.approveAuthorization).not.toHaveBeenCalled();
  });

  it.each([
    ["expired", "Authorization request has expired."],
    ["invalid", "Authorization request is invalid."],
  ])("shows an %s authorization lookup error", async (_kind, message) => {
    oauthMocks.getAuthorizationDetails.mockResolvedValue({
      data: null,
      error: new Error(message),
    });
    render(<OAuthConsentScreen authorizationId="auth-request-123" onComplete={vi.fn()} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(message);
    expect(screen.queryByRole("button", { name: "Approve access" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Deny" })).not.toBeInTheDocument();
    expect(browserRedirect).not.toHaveBeenCalled();
  });

  it("redirects when Supabase reports that the authorization is already resolved", async () => {
    const events: string[] = [];
    const onComplete = vi.fn(() => events.push("complete"));
    browserRedirect.mockImplementation((url: string) => events.push(`redirect:${url}`));
    oauthMocks.getAuthorizationDetails.mockResolvedValue({
      data: { redirect_url: redirectUrl },
      error: null,
    });
    render(<OAuthConsentScreen authorizationId="auth-request-123" onComplete={onComplete} />);

    await waitFor(() => expect(browserRedirect).toHaveBeenCalledWith(redirectUrl));

    expect(onComplete).toHaveBeenCalledOnce();
    expect(events).toEqual(["complete", `redirect:${redirectUrl}`]);
    expect(oauthMocks.approveAuthorization).not.toHaveBeenCalled();
    expect(oauthMocks.denyAuthorization).not.toHaveBeenCalled();
  });

  it("disables both decisions while submission is pending and ignores repeated clicks", async () => {
    let resolveApproval!: (value: {
      data: { redirect_url: string };
      error: null;
    }) => void;
    oauthMocks.approveAuthorization.mockReturnValue(
      new Promise((resolve) => {
        resolveApproval = resolve;
      }),
    );
    render(<OAuthConsentScreen authorizationId="auth-request-123" onComplete={vi.fn()} />);

    const approveButton = await screen.findByRole("button", { name: "Approve access" });
    const denyButton = screen.getByRole("button", { name: "Deny" });
    act(() => {
      approveButton.click();
      approveButton.click();
      denyButton.click();
    });

    expect(approveButton).toBeDisabled();
    expect(denyButton).toBeDisabled();
    expect(oauthMocks.approveAuthorization).toHaveBeenCalledOnce();
    expect(oauthMocks.denyAuthorization).not.toHaveBeenCalled();

    await act(async () => {
      resolveApproval({ data: { redirect_url: redirectUrl }, error: null });
    });
  });
});
