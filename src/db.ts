import { Database } from "bun:sqlite";
import type { TrackedSession } from "./devin";

const DB_PATH = process.env.DB_PATH ?? "sessions.db";
const db = new Database(DB_PATH);

db.run(`CREATE TABLE IF NOT EXISTS sessions (
  session_id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new',
  status_detail TEXT,
  title TEXT,
  issue_number INTEGER NOT NULL,
  issue_title TEXT NOT NULL,
  acus_consumed REAL DEFAULT 0,
  pr_outcome TEXT,
  pr_merged_at INTEGER,
  pull_requests TEXT DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
)`);

const insertStmt = db.prepare(`INSERT OR REPLACE INTO sessions
  (session_id, url, status, status_detail, title, issue_number, issue_title, acus_consumed, pr_outcome, pr_merged_at, pull_requests, created_at, updated_at)
  VALUES ($session_id, $url, $status, $status_detail, $title, $issue_number, $issue_title, $acus_consumed, $pr_outcome, $pr_merged_at, $pull_requests, $created_at, $updated_at)`);

const getByIdStmt = db.prepare("SELECT * FROM sessions WHERE session_id = $id");
const getByPrUrlStmt = db.prepare("SELECT * FROM sessions WHERE pull_requests LIKE $pattern");
const getAllStmt = db.prepare("SELECT * FROM sessions ORDER BY created_at DESC");
const getInRangeStmt = db.prepare("SELECT * FROM sessions WHERE created_at >= $cutoff ORDER BY created_at DESC");

function toRow(s: TrackedSession) {
  return {
    $session_id: s.session_id,
    $url: s.url,
    $status: s.status,
    $status_detail: s.status_detail ?? null,
    $title: s.title ?? null,
    $issue_number: s.issue_number,
    $issue_title: s.issue_title,
    $acus_consumed: s.acus_consumed,
    $pr_outcome: s.pr_outcome ?? null,
    $pr_merged_at: s.pr_merged_at ?? null,
    $pull_requests: JSON.stringify(s.pull_requests),
    $created_at: s.created_at,
    $updated_at: s.updated_at,
  };
}

function fromRow(row: any): TrackedSession {
  return {
    session_id: row.session_id,
    url: row.url,
    status: row.status,
    status_detail: row.status_detail ?? undefined,
    title: row.title ?? undefined,
    issue_number: row.issue_number,
    issue_title: row.issue_title,
    acus_consumed: row.acus_consumed,
    pr_outcome: row.pr_outcome ?? undefined,
    pr_merged_at: row.pr_merged_at ?? undefined,
    pull_requests: JSON.parse(row.pull_requests),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export function save(session: TrackedSession): void {
  insertStmt.run(toRow(session));
}

export function getById(sessionId: string): TrackedSession | null {
  const row = getByIdStmt.get({ $id: sessionId });
  return row ? fromRow(row) : null;
}

export function getByPrUrl(prUrl: string): TrackedSession | null {
  const row = getByPrUrlStmt.get({ $pattern: `%${prUrl}%` });
  return row ? fromRow(row) : null;
}

export function getAll(): TrackedSession[] {
  return getAllStmt.all().map(fromRow);
}

export function getInRange(range: string): TrackedSession[] {
  const now = Date.now();
  const ms: Record<string, number> = { "1d": 86400000, "1w": 604800000, "1m": 2592000000 };
  if (range === "all" || !ms[range]) return getAll();
  const cutoff = now - ms[range];
  return getInRangeStmt.all({ $cutoff: cutoff }).map(fromRow);
}
