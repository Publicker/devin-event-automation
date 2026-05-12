import { Hono } from "hono";
import { createSession, getSessionsInRange, pollSession, updatePROutcome } from "./devin";

const app = new Hono();

const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET ?? "";

async function verifySignature(body: string, signature: string | undefined): Promise<boolean> {
  if (!WEBHOOK_SECRET) return true;
  if (!signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", encoder.encode(WEBHOOK_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
  const expected = `sha256=${Buffer.from(sig).toString("hex")}`;
  return expected === signature;
}

app.post("/webhook", async (c) => {
  const body = await c.req.text();
  const signature = c.req.header("x-hub-signature-256");

  if (!await verifySignature(body, signature)) {
    return c.json({ error: "invalid signature" }, 401);
  }

  const event = c.req.header("x-github-event");
  const payload = JSON.parse(body);

  if (event === "issues" && payload.action === "opened") {
    return handleIssueOpened(c, payload);
  }

  if (event === "pull_request" && (payload.action === "closed" || payload.action === "reopened")) {
    return handlePRUpdate(c, payload);
  }

  return c.json({ skipped: true }, 200);
});

async function handleIssueOpened(c: any, payload: any) {
  const issue = payload.issue;
  const repo = payload.repository;

  console.log(`[webhook] Issue #${issue.number} opened: ${issue.title}`);

  try {
    const session = await createSession({
      issueNumber: issue.number,
      issueTitle: issue.title,
      issueBody: issue.body ?? "",
      repoUrl: repo.html_url,
    });

    console.log(`[devin] Session created: ${session.session_id} → ${session.url}`);
    broadcast();
    return c.json({ session_id: session.session_id, url: session.url }, 201);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    console.error(`[error] ${msg}`);
    return c.json({ error: msg }, 502);
  }
}

function handlePRUpdate(c: any, payload: any) {
  const pr = payload.pull_request;
  const prUrl = pr.html_url;
  const outcome = pr.merged ? "merged" : payload.action === "closed" ? "closed" : "open";

  console.log(`[webhook] PR ${prUrl} → ${outcome}`);
  const session = updatePROutcome(prUrl, outcome);

  if (!session) return c.json({ skipped: true, reason: "untracked PR" }, 200);
  broadcast();
  return c.json({ updated: true, session_id: session.session_id, pr_outcome: outcome }, 200);
}

app.get("/status", async (c) => {
  const range = (c.req.query("range") ?? "1w") as string;
  return c.json(await buildStatus(range));
});

app.get("/health", (c) => c.json({ ok: true }));

app.get("/", () => {
  const html = Bun.file(new URL("dashboard.html", import.meta.url).pathname);
  return new Response(html, { headers: { "content-type": "text/html" } });
});

async function buildStatus(range: string) {
  const sessions = getSessionsInRange(range);

  for (const s of sessions) {
    if (!["exit", "error"].includes(s.status)) {
      await pollSession(s.session_id);
    }
  }

  const updated = getSessionsInRange(range);
  const prsOpened = updated.filter((s) => s.pull_requests.length > 0).length;
  const prsMerged = updated.filter((s) => s.pr_outcome === "merged").length;
  const prsClosed = updated.filter((s) => s.pr_outcome === "closed").length;

  return {
    range,
    summary: {
      total_issues: updated.length,
      prs_opened: prsOpened,
      prs_merged: prsMerged,
      prs_closed: prsClosed,
      success_rate: prsOpened ? `${Math.round((prsMerged / prsOpened) * 100)}%` : "N/A",
      active: updated.filter((s) => !["exit", "error"].includes(s.status)).length,
      failed: updated.filter((s) => s.status === "error").length,
    },
    sessions: updated.map((s) => ({
      issue: `#${s.issue_number}`,
      title: s.issue_title,
      status: s.status,
      detail: s.status_detail,
      pr: s.pull_requests[0]?.pr_url ?? null,
      pr_outcome: s.pr_outcome ?? null,
      devin_url: s.url,
      acus: s.acus_consumed,
      duration: formatDuration(Math.round((s.updated_at - s.created_at) / 1000)),
    })),
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

async function broadcast() {
  server.publish("status", JSON.stringify({ type: "refresh" }));
}

const port = Number(process.env.PORT ?? 3000);

const server = Bun.serve({
  port,
  fetch(req, server) {
    if (new URL(req.url).pathname === "/ws") {
      if (server.upgrade(req)) return;
      return new Response("Upgrade failed", { status: 400 });
    }
    return app.fetch(req);
  },
  websocket: {
    open(ws) {
      ws.subscribe("status");
    },
    message(ws, msg) {
      const { type, range } = JSON.parse(msg as string);
      if (type === "poll") {
        buildStatus(range ?? "1w").then((data) => ws.send(JSON.stringify(data)));
      }
    },
    close(ws) {
      ws.unsubscribe("status");
    },
  },
});

console.log(`[server] Listening on :${port}`);
