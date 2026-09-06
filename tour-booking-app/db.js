import Database from 'better-sqlite3';
import { randomBytes } from 'node:crypto';

const db = new Database(process.env.DB_PATH || 'tours.db');
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function init() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS tours (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      created_at   TEXT    NOT NULL,
      name         TEXT    NOT NULL,
      email        TEXT    NOT NULL,
      phone        TEXT    NOT NULL,
      plan         TEXT    NOT NULL,
      slot_start   TEXT    NOT NULL,
      slot_end     TEXT    NOT NULL,
      message      TEXT    NOT NULL DEFAULT '',
      status       TEXT    NOT NULL DEFAULT 'pending',
      token        TEXT    NOT NULL UNIQUE,
      decided_at   TEXT,
      decline_note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_tours_slot   ON tours (slot_start);
    CREATE INDEX IF NOT EXISTS idx_tours_status ON tours (status, slot_start);
  `);
}
init();

/** Slots held by a live request. Cancelled/declined slots free up again. */
const HELD = `('pending','approved')`;

export const queries = {
  heldSlots(fromIso, toIso) {
    return db
      .prepare(
        `SELECT slot_start FROM tours
          WHERE status IN ${HELD} AND slot_start >= ? AND slot_start < ?`
      )
      .all(fromIso, toIso)
      .map((r) => r.slot_start);
  },

  isSlotTaken(slotStartIso) {
    const row = db
      .prepare(`SELECT 1 FROM tours WHERE slot_start = ? AND status IN ${HELD} LIMIT 1`)
      .get(slotStartIso);
    return Boolean(row);
  },

  /** Guards against the same email spamming many open requests. */
  openRequestsForEmail(email) {
    return db
      .prepare(`SELECT COUNT(*) AS n FROM tours WHERE email = ? AND status IN ${HELD}`)
      .get(email).n;
  },

  create(tour) {
    const token = randomBytes(24).toString('hex');
    const info = db
      .prepare(
        `INSERT INTO tours (created_at, name, email, phone, plan, slot_start, slot_end, message, status, token)
         VALUES (@created_at, @name, @email, @phone, @plan, @slot_start, @slot_end, @message, 'pending', @token)`
      )
      .run({ ...tour, created_at: new Date().toISOString(), token });
    return this.byId(info.lastInsertRowid);
  },

  byId(id) {
    return db.prepare(`SELECT * FROM tours WHERE id = ?`).get(id);
  },

  byToken(token) {
    return db.prepare(`SELECT * FROM tours WHERE token = ?`).get(token);
  },

  list(status) {
    if (status && status !== 'all') {
      return db
        .prepare(`SELECT * FROM tours WHERE status = ? ORDER BY slot_start ASC`)
        .all(status);
    }
    return db.prepare(`SELECT * FROM tours ORDER BY slot_start ASC`).all();
  },

  counts() {
    const rows = db.prepare(`SELECT status, COUNT(*) AS n FROM tours GROUP BY status`).all();
    return Object.fromEntries(rows.map((r) => [r.status, r.n]));
  },

  /**
   * Only moves a tour out of 'pending'. Returns the updated row, or null if it
   * was already decided — which keeps a double-clicked Approve from sending two emails.
   */
  decide(id, status, declineNote = null) {
    const info = db
      .prepare(
        `UPDATE tours SET status = ?, decided_at = ?, decline_note = ?
          WHERE id = ? AND status = 'pending'`
      )
      .run(status, new Date().toISOString(), declineNote, id);
    return info.changes === 1 ? this.byId(id) : null;
  },

  cancelByToken(token) {
    const info = db
      .prepare(
        `UPDATE tours SET status = 'cancelled', decided_at = ?
          WHERE token = ? AND status IN ${HELD}`
      )
      .run(new Date().toISOString(), token);
    return info.changes === 1 ? this.byToken(token) : null;
  }
};

export default db;
