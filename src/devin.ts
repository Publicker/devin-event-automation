import * as db from "./db";

const BASE = "https://api.devin.ai/v3/organizations";

const API_KEY = process.env.DEVIN_API_KEY ?? "";
const ORG_ID = process.env.DEVIN_ORG_ID ?? "";

type SessionStatus = "new" | "claimed" | "running" | "exit" | "error" | "suspended" | "resuming";
type PROutcome = "open" | "merged" | "closed";

export interface TrackedSession {
  session_id: string;
  url: string;
  status: SessionStatus;
  status_detail?: string;
  title?: string;
  pull_requests: { pr_url: string; pr_state: string }[];
  created_at: number;
  updated_at: number;
  issue_number: number;
  issue_title: string;
  acus_consumed: number;
  pr_outcome?: PROutcome;
  pr_merged_at?: number;
}

function toMs(ts: number): number {
  return ts < 1e12 ? ts * 1000 : ts;
}

export function getAllSessions(): TrackedSession[] {
  return db.getAll();
}

export function getSessionsInRange(range: string): TrackedSession[] {
  return db.getInRange(range);
}

export function updatePROutcome(prUrl: string, outcome: PROutcome): TrackedSession | null {
  const session = db.getByPrUrl(prUrl);
  if (!session) return null;

  const pr = session.pull_requests.find((p) => p.pr_url === prUrl);
  if (pr) pr.pr_state = outcome;
  session.pr_outcome = outcome;
  if (outcome === "merged") session.pr_merged_at = Date.now();

  db.save(session);
  console.log(`[pr] ${prUrl} → ${outcome} (session ${session.session_id})`);
  return session;
}

export async function createSession(opts: {
  issueNumber: number;
  issueTitle: string;
  issueBody: string;
  repoUrl: string;
}): Promise<TrackedSession> {
  const prompt = buildPrompt(opts);

  const res = await fetch(`${BASE}/${ORG_ID}/sessions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      prompt,
      repos: [opts.repoUrl],
      title: `Fix: ${opts.issueTitle}`,
      tags: ["automated", "issue-fix"],
    }),
  });

  if (!res.ok) throw new Error(`Devin API error: ${res.status} ${await res.text()}`);

  const data = (await res.json()) as any;
  const tracked: TrackedSession = {
    session_id: data.session_id,
    url: data.url,
    status: data.status,
    status_detail: data.status_detail,
    title: data.title,
    pull_requests: data.pull_requests ?? [],
    created_at: toMs(data.created_at ?? Date.now()),
    updated_at: toMs(data.updated_at ?? Date.now()),
    issue_number: opts.issueNumber,
    issue_title: opts.issueTitle,
    acus_consumed: data.acus_consumed ?? 0,
  };
  db.save(tracked);
  return tracked;
}

export async function pollSession(sessionId: string): Promise<TrackedSession | null> {
  const tracked = db.getById(sessionId);
  if (!tracked) return null;

  const res = await fetch(`${BASE}/${ORG_ID}/sessions/${sessionId}`, {
    headers: { Authorization: `Bearer ${API_KEY}` },
  });

  if (!res.ok) return tracked;

  const data = (await res.json()) as any;
  tracked.status = data.status;
  tracked.status_detail = data.status_detail;
  tracked.pull_requests = data.pull_requests ?? tracked.pull_requests;
  tracked.updated_at = toMs(data.updated_at ?? tracked.updated_at);
  tracked.acus_consumed = data.acus_consumed ?? tracked.acus_consumed;
  db.save(tracked);
  return tracked;
}

function buildPrompt(opts: { issueNumber: number; issueTitle: string; issueBody: string; repoUrl: string }): string {
  return `You are fixing a bug reported in issue #${opts.issueNumber} of ${opts.repoUrl}.

## Issue: ${opts.issueTitle}

${opts.issueBody}

## Instructions

1. Reproduce the bug by reading the relevant code and understanding the root cause.
2. Implement a fix with minimal changes.
3. Verify the fix doesn't break existing tests.
4. Create a pull request that:
   - References issue #${opts.issueNumber}
   - Explains what caused the bug
   - Describes the fix and why it works
   - Shows before/after behavior

Keep the PR description concise but informative.`;
}
