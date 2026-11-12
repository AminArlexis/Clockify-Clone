import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import App from "../App";
import { createMockData } from "../data/mock";
import { AppStoreProvider, useAppStore } from "./AppStore";

const DATA_KEY = "timeflow-prototype-data-v2";
const SESSION_KEY = "timeflow-prototype-session";
const EXPIRY_KEY = "timeflow-prototype-session-expiry";

function seedSession(userId = "u1") {
  localStorage.setItem(DATA_KEY, JSON.stringify(createMockData()));
  localStorage.setItem(SESSION_KEY, userId);
  localStorage.setItem(EXPIRY_KEY, String(Date.now() + 60_000));
}

function StoreHarness() {
  const store = useAppStore();
  return (
    <div>
      <output data-testid="workspace">{store.data.activeWorkspaceId}</output>
      <output data-testid="timer">{store.data.activeTimer?.status || "none"}</output>
      <output data-testid="segments">{store.data.activeTimer?.segments.length || 0}</output>
      <output data-testid="entries">{store.data.entries.length}</output>
      <output data-testid="error">{store.timerError}</output>
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
    seedSession();
  });

  it("starts, pauses, resumes, and stops one timer without duplicates", async () => {
    render(
      <AppStoreProvider>
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
      <AppStoreProvider>
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
    seedSession("u1");
    const { unmount } = render(<App />);
    expect(screen.getByRole("button", { name: "Team" })).toBeInTheDocument();
    unmount();
    localStorage.clear();
    seedSession("u2");
    render(<App />);
    expect(screen.queryByRole("button", { name: "Team" })).not.toBeInTheDocument();
  });

  it("renders the public landing page at the root path", () => {
    localStorage.clear();
    render(<App />);
    expect(
      screen.getByRole("heading", { name: /time tracking that gets out of your way/i }),
    ).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "Log in" })[0]);
    expect(screen.getByRole("heading", { name: "Sign in to TimeFlow" })).toBeInTheDocument();
  });
});
