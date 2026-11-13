import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "../App";
import { fetchAppDataFromSupabase } from "../lib/supabaseSync";
import { createTestData } from "../test/fixtures";
import { AppStoreProvider, useAppStore } from "./AppStore";

vi.mock("../lib/supabaseSync", () => ({
  fetchAppDataFromSupabase: vi.fn(),
  syncUserToSupabase: vi.fn().mockResolvedValue(undefined),
  syncEntryToSupabase: vi.fn().mockResolvedValue(undefined),
  deleteEntryFromSupabase: vi.fn().mockResolvedValue(undefined),
  syncProjectToSupabase: vi.fn().mockResolvedValue(undefined),
  syncTaskToSupabase: vi.fn().mockResolvedValue(undefined),
  syncTagToSupabase: vi.fn().mockResolvedValue(undefined),
  deleteTagFromSupabase: vi.fn().mockResolvedValue(undefined),
  syncActiveTimerToSupabase: vi.fn().mockResolvedValue(undefined),
  syncAuditEventToSupabase: vi.fn().mockResolvedValue(undefined),
}));

function StoreHarness() {
  const store = useAppStore();
  return (
    <div>
      <output data-testid="workspace">{store.data.activeWorkspaceId}</output>
      <output data-testid="timer">{store.data.activeTimer?.status || "none"}</output>
      <output data-testid="segments">{store.data.activeTimer?.segments.length || 0}</output>
      <output data-testid="entries">{store.data.entries.length}</output>
      <output data-testid="error">{store.timerError}</output>
      <output data-testid="data-error">{store.dataError}</output>
      <button onClick={() => store.startTimer({ description: "Test timer", tagIds: [] })}>
        start
      </button>
      <button onClick={store.pauseTimer}>pause</button>
      <button onClick={store.resumeTimer}>resume</button>
      <button onClick={store.stopTimer}>stop</button>
      <button onClick={() => store.switchWorkspace("w2")}>workspace two</button>
      <button
        onClick={() =>
          store.saveEntry({
            userId: "u1",
            description: "Manual entry",
            tagIds: [],
            start: "2025-03-01T09:00:00.000Z",
            end: "2025-03-01T10:00:00.000Z",
          })
        }
      >
        add entry
      </button>
    </div>
  );
}

describe("shared application store", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("does not restore legacy browser demo data", () => {
    localStorage.setItem("timeflow-prototype-data-v2", JSON.stringify(createTestData()));
    render(
      <AppStoreProvider>
        <StoreHarness />
      </AppStoreProvider>,
    );
    expect(screen.getByTestId("entries").textContent).toBe("0");
  });

  it("treats a missing profile as an empty workspace instead of a login error", async () => {
    vi.mocked(fetchAppDataFromSupabase).mockResolvedValue(null);
    render(
      <AppStoreProvider initialSessionId="new-auth-user">
        <StoreHarness />
      </AppStoreProvider>,
    );
    await waitFor(() => expect(fetchAppDataFromSupabase).toHaveBeenCalledWith("new-auth-user"));
    expect(screen.getByTestId("data-error").textContent).toBe("");
  });

  it("starts, pauses, resumes, and stops one timer without duplicates", async () => {
    render(
      <AppStoreProvider initialData={createTestData()} initialSessionId="u1">
        <StoreHarness />
      </AppStoreProvider>,
    );
    const before = Number(screen.getByTestId("entries").textContent);
    fireEvent.click(screen.getByText("start"));
    expect(screen.getByTestId("timer")).toHaveTextContent("running");
    fireEvent.click(screen.getByText("start"));
    expect(screen.getByTestId("segments")).toHaveTextContent("1");
    await Promise.resolve();
    fireEvent.click(screen.getByText("pause"));
    expect(screen.getByTestId("timer")).toHaveTextContent("paused");
    await Promise.resolve();
    fireEvent.click(screen.getByText("resume"));
    expect(screen.getByTestId("segments")).toHaveTextContent("3");
    await Promise.resolve();
    fireEvent.click(screen.getByText("stop"));
    expect(screen.getByTestId("timer")).toHaveTextContent("none");
    expect(screen.getByTestId("entries")).toHaveTextContent(String(before + 1));
  });

  it("switches workspaces and isolates visible records", () => {
    render(
      <AppStoreProvider initialData={createTestData()} initialSessionId="u1">
        <StoreHarness />
      </AppStoreProvider>,
    );
    expect(Number(screen.getByTestId("entries").textContent)).toBeGreaterThan(0);
    fireEvent.click(screen.getByText("workspace two"));
    expect(screen.getByTestId("workspace")).toHaveTextContent("w2");
    expect(screen.getByTestId("entries")).toHaveTextContent("0");
    fireEvent.click(screen.getByText("add entry"));
    expect(screen.getByTestId("entries")).toHaveTextContent("1");
  });
});

describe("role-based interface", () => {
  beforeEach(() => {
    localStorage.clear();
    window.history.replaceState({}, "", "/");
  });

  it("shows admin navigation only to admins", () => {
    const data = createTestData();
    const { unmount } = render(<App initialData={data} initialSessionId="u1" />);
    expect(screen.getByRole("button", { name: "Team" })).toBeInTheDocument();
    unmount();
    localStorage.clear();
    render(<App initialData={createTestData()} initialSessionId="u2" />);
    expect(screen.queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
  });

  it("renders the public landing page at the root path", () => {
    localStorage.clear();
    render(<App initialData={createTestData()} />);
    expect(
      screen.getByRole("heading", { name: /time tracking that gets out of your way/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Log in" })[0]);
    expect(screen.getByRole("heading", { name: "Sign in to TimeFlow" })).toBeInTheDocument();
  });
});
