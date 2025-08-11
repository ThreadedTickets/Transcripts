import sqlite3 from "better-sqlite3";
import fs from "fs";

const db = sqlite3("transcripts.db");

// =======================
// Database Initialization
// =======================
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS transcripts (
    id TEXT PRIMARY KEY,
    server TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME,
    is_permanent BOOLEAN DEFAULT FALSE
  )
`
).run();

db.prepare(
  `
  CREATE INDEX IF NOT EXISTS idx_transcripts_expiry 
  ON transcripts (expires_at) 
  WHERE is_permanent = FALSE
`
).run();
db.prepare(
  `
  CREATE INDEX IF NOT EXISTS idx_transcripts_server 
  ON transcripts (server)
`
).run();

// Table for tags
db.prepare(
  `
  CREATE TABLE IF NOT EXISTS transcript_tags (
    transcript_id TEXT NOT NULL,
    tag TEXT NOT NULL,
    PRIMARY KEY (transcript_id, tag),
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE
  )
`
).run();

db.prepare(
  `
  CREATE INDEX IF NOT EXISTS idx_transcript_tags_tag
  ON transcript_tags (tag)
`
).run();

// =======================
// Create transcript
// =======================
export function createTranscriptInDb(
  transcriptId: string,
  serverId: string,
  isPermanent = false,
  tags: string[] = []
): void {
  const expiresAt = isPermanent
    ? null
    : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

  const insertTranscript = db.prepare(`
    INSERT INTO transcripts (id, server, expires_at, is_permanent)
    VALUES (?, ?, ?, ?)
  `);

  const insertTag = db.prepare(`
    INSERT OR IGNORE INTO transcript_tags (transcript_id, tag)
    VALUES (?, ?)
  `);

  const transaction = db.transaction(
    (
      id: string,
      server: string,
      exp: string | null,
      perm: number,
      tagsArr: string[]
    ) => {
      insertTranscript.run(id, server, exp, perm);
      for (const tag of tagsArr) {
        if (tag && tag.trim()) {
          insertTag.run(id, tag.trim());
        }
      }
    }
  );

  transaction(transcriptId, serverId, expiresAt, isPermanent ? 1 : 0, tags);
}

// =======================
// Tag management
// =======================
export function addTag(transcriptId: string, tag: string): void {
  if (!tag.trim()) return;
  db.prepare(
    `
    INSERT OR IGNORE INTO transcript_tags (transcript_id, tag)
    VALUES (?, ?)
  `
  ).run(transcriptId, tag.trim());
}

export function removeTag(transcriptId: string, tag: string): void {
  db.prepare(
    `
    DELETE FROM transcript_tags
    WHERE transcript_id = ? AND tag = ?
  `
  ).run(transcriptId, tag.trim());
}

// =======================
// Search transcripts
// =======================

export type MatchMode = "any" | "all";

export function findTranscripts(
  server: string,
  tags?: string[],
  mode: MatchMode = "any"
): any[] {
  if (!tags?.length)
    return db
      .prepare(`SELECT id FROM transcripts WHERE server = ?`)
      .all(server);

  const placeholders = tags.map(() => "?").join(", ");

  if (mode === "any") {
    return db
      .prepare(
        `
      SELECT DISTINCT t.*
      FROM transcripts t
      JOIN transcript_tags tt ON t.id = tt.transcript_id
      WHERE t.server = ? AND tt.tag IN (${placeholders})
    `
      )
      .all(server, ...tags);
  } else {
    return db
      .prepare(
        `
      SELECT t.*
      FROM transcripts t
      JOIN transcript_tags tt ON t.id = tt.transcript_id
      WHERE t.server = ? AND tt.tag IN (${placeholders})
      GROUP BY t.id
      HAVING COUNT(DISTINCT tt.tag) = ${tags.length}
    `
      )
      .all(server, ...tags);
  }
}

// =======================
// Cleanup expired
// =======================
export async function cleanupExpiredTranscripts(): Promise<void> {
  setInterval(async () => {
    while (true) {
      const now = new Date().toISOString();

      const oldest: any = db
        .prepare(
          `
          SELECT id FROM transcripts
          WHERE is_permanent = FALSE AND expires_at < ?
          ORDER BY expires_at ASC
          LIMIT 1
        `
        )
        .get(now);

      if (!oldest) return;

      // Delete associated tags explicitly
      db.prepare(`DELETE FROM transcript_tags WHERE transcript_id = ?`).run(
        oldest.id
      );

      // Delete the expired transcript
      db.prepare(`DELETE FROM transcripts WHERE id = ?`).run(oldest.id);

      // Delete associated files
      await deleteTranscriptData(oldest.id);
    }
  }, 3600000);
}

// =======================
// Delete transcript files
// =======================
async function deleteTranscriptData(transcriptId: string): Promise<void> {
  try {
    fs.unlinkSync(`./transcripts/complete/${transcriptId}.json`);
  } catch (err: any) {
    if (err.code !== "ENOENT") throw err;
  }
}
