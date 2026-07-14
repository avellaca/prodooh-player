/**
 * Browser shim for better-sqlite3.
 *
 * In the browser environment (local dev/testing on Mac), SQLite is not
 * available. This shim provides a minimal in-memory key-value store
 * backed by localStorage that implements the subset of the better-sqlite3
 * API used by LocalConfigStore, PlaylistSource, POPQueue, and PlaybackLogger.
 *
 * On the Raspberry Pi, the real better-sqlite3 module is used (Node.js runtime).
 */

// In-memory storage that persists to localStorage
const STORAGE_PREFIX = 'prodooh_db_';

interface Row {
  [key: string]: unknown;
}

class BrowserStatement {
  private sql: string;
  private db: BrowserDatabase;

  constructor(sql: string, db: BrowserDatabase) {
    this.sql = sql;
    this.db = db;
  }

  run(...params: unknown[]): { changes: number; lastInsertRowid: number } {
    this.db.executeWrite(this.sql, params);
    return { changes: 1, lastInsertRowid: 0 };
  }

  get(...params: unknown[]): Row | undefined {
    return this.db.executeRead(this.sql, params)[0];
  }

  all(...params: unknown[]): Row[] {
    return this.db.executeRead(this.sql, params);
  }
}

class BrowserDatabase {
  private tables: Map<string, Row[]> = new Map();
  private storageKey: string;

  constructor(path: string) {
    this.storageKey = STORAGE_PREFIX + (path || 'memory');
    this.loadFromStorage();
  }

  prepare(sql: string): BrowserStatement {
    return new BrowserStatement(sql, this);
  }

  exec(sql: string): void {
    // Parse CREATE TABLE statements to initialize tables
    const createMatches = sql.matchAll(
      /CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\s+(\w+)/gi
    );
    for (const match of createMatches) {
      const tableName = match[1]!;
      if (!this.tables.has(tableName)) {
        this.tables.set(tableName, []);
      }
    }
    // Handle DELETE statements
    const deleteMatch = sql.match(/DELETE\s+FROM\s+(\w+)/i);
    if (deleteMatch) {
      this.tables.set(deleteMatch[1]!, []);
      this.saveToStorage();
    }
  }

  pragma(_pragma: string): void {
    // No-op in browser
  }

  close(): void {
    this.saveToStorage();
  }

  transaction<T>(fn: () => T): () => T {
    return () => {
      const result = fn();
      this.saveToStorage();
      return result;
    };
  }

  // Internal: execute a write query (INSERT, UPDATE, DELETE)
  executeWrite(sql: string, params: unknown[]): void {
    const insertMatch = sql.match(
      /INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+(\w+)\s*\(([^)]+)\)\s*VALUES\s*\(([^)]+)\)/is
    );
    if (insertMatch) {
      const table = insertMatch[1]!;
      const columns = insertMatch[2]!.split(',').map((c) => c.trim());
      const valuePlaceholders = insertMatch[3]!.split(',').map((v) => v.trim());
      const row: Row = {};
      let paramIdx = 0;
      columns.forEach((col, i) => {
        const placeholder = valuePlaceholders[i];
        if (placeholder === '?') {
          row[col] = params[paramIdx++] ?? null;
        } else {
          // Literal value — parse it
          const numVal = Number(placeholder);
          if (!isNaN(numVal)) {
            row[col] = numVal;
          } else if (placeholder?.startsWith("'") && placeholder?.endsWith("'")) {
            row[col] = placeholder.slice(1, -1);
          } else {
            row[col] = placeholder;
          }
        }
      });
      if (!this.tables.has(table)) {
        this.tables.set(table, []);
      }
      // Handle ON CONFLICT (upsert) - replace by primary key (first column)
      if (sql.toLowerCase().includes('on conflict')) {
        const rows = this.tables.get(table)!;
        const pkCol = columns[0]!;
        const idx = rows.findIndex((r) => r[pkCol] === row[pkCol]);
        if (idx >= 0) {
          rows[idx] = row;
        } else {
          rows.push(row);
        }
      } else {
        this.tables.get(table)!.push(row);
      }
      this.saveToStorage();
      return;
    }

    const updateMatch = sql.match(/UPDATE\s+(\w+)\s+SET\s+(.+?)\s+WHERE\s+(.+)/i);
    if (updateMatch) {
      const table = updateMatch[1]!;
      const rows = this.tables.get(table) || [];
      // Simple single-column WHERE parsing
      const whereCol = updateMatch[3]!.match(/(\w+)\s*=\s*\?/)?.[1];
      const setClause = updateMatch[2]!;
      const setCols = setClause.split(',').map((s) => s.trim().match(/(\w+)\s*=\s*\?/)?.[1]).filter(Boolean) as string[];

      if (whereCol) {
        const whereVal = params[setCols.length];
        rows.forEach((row) => {
          if (row[whereCol] === whereVal) {
            setCols.forEach((col, i) => {
              row[col] = params[i] ?? null;
            });
          }
        });
      }
      this.saveToStorage();
      return;
    }

    const deleteMatch = sql.match(/DELETE\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+))?/i);
    if (deleteMatch) {
      const table = deleteMatch[1]!;
      if (!deleteMatch[2]) {
        this.tables.set(table, []);
      } else {
        const whereClause = deleteMatch[2];
        // Support: WHERE col IN (?, ?, ...)
        const inMatch = whereClause.match(/(\w+)\s+IN\s*\(([^)]+)\)/i);
        if (inMatch) {
          const col = inMatch[1]!;
          const rows = this.tables.get(table) || [];
          const valuesToDelete = new Set(params.map(String));
          this.tables.set(table, rows.filter((r) => !valuesToDelete.has(String(r[col]))));
        } else {
          // Support: WHERE col = ?
          const whereCol = whereClause.match(/(\w+)\s*=\s*\?/)?.[1];
          if (whereCol) {
            const rows = this.tables.get(table) || [];
            const whereVal = params[0];
            this.tables.set(table, rows.filter((r) => r[whereCol] !== whereVal));
          }
        }
      }
      this.saveToStorage();
    }
  }

  // Internal: execute a read query (SELECT)
  executeRead(sql: string, params: unknown[]): Row[] {
    const selectMatch = sql.match(
      /SELECT\s+(.+?)\s+FROM\s+(\w+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(.+?))?(?:\s+LIMIT\s+(\d+|\?))?\s*$/is
    );
    if (!selectMatch) return [];

    const table = selectMatch[2]!;
    const rows = this.tables.get(table) || [];
    let result = [...rows];

    // Apply WHERE clause
    const whereClause = selectMatch[3];
    if (whereClause) {
      // Strip outer parentheses for simpler parsing
      const cleanWhere = whereClause.replace(/^\s*\(/, '').replace(/\)\s*$/, '').trim();

      // Check if this is an OR condition
      if (/\bOR\b/i.test(cleanWhere)) {
        const orParts = cleanWhere.split(/\s+OR\s+/i);
        let paramIdx = 0;
        result = result.filter((row) => {
          return orParts.some((part) => {
            const trimmed = part.replace(/^\(/, '').replace(/\)$/, '').trim();
            return this.evaluateCondition(trimmed, row, params, paramIdx);
          });
        });
      } else {
        // AND conditions (existing logic, extended)
        const conditions = cleanWhere.split(/\s+AND\s+/i);
        let paramIdx = 0;
        for (const cond of conditions) {
          const trimmed = cond.replace(/^\(/, '').replace(/\)$/, '').trim();
          result = result.filter((row) => this.evaluateCondition(trimmed, row, params, paramIdx));
          // Advance paramIdx for each ? used
          if (trimmed.includes('?')) paramIdx++;
        }
      }
    }

    // Apply ORDER BY (simple single column)
    const orderBy = selectMatch[4];
    if (orderBy) {
      const orderMatch = orderBy.match(/(\w+)\s*(ASC|DESC)?/i);
      if (orderMatch) {
        const col = orderMatch[1]!;
        const desc = orderMatch[2]?.toUpperCase() === 'DESC';
        result.sort((a, b) => {
          const av = a[col] as number | string;
          const bv = b[col] as number | string;
          if (av < bv) return desc ? 1 : -1;
          if (av > bv) return desc ? -1 : 1;
          return 0;
        });
      }
    }

    // Apply LIMIT
    const limit = selectMatch[5];
    if (limit) {
      const n = limit === '?' ? (params[params.length - 1] as number) : parseInt(limit);
      result = result.slice(0, n);
    }

    // Handle COUNT(*)
    const cols = selectMatch[1]!;
    if (cols.includes('COUNT(*)')) {
      return [{ count: result.length }];
    }

    return result;
  }

  /**
   * Evaluate a single WHERE condition against a row.
   * Supports: col = ? | col = 'literal' | col <= ? | col IN (...)
   */
  private evaluateCondition(cond: string, row: Row, params: unknown[], _paramIdx: number): boolean {
    // Match: column = 'string_literal'
    const eqLiteralMatch = cond.match(/(\w+)\s*=\s*'([^']+)'/);
    if (eqLiteralMatch) {
      const col = eqLiteralMatch[1]!;
      const val = eqLiteralMatch[2]!;
      return row[col] === val;
    }

    // Match: column = ?
    const eqParamMatch = cond.match(/(\w+)\s*=\s*\?/);
    if (eqParamMatch) {
      const col = eqParamMatch[1]!;
      const val = params[_paramIdx];
      return row[col] === val;
    }

    // Match: column <= ?
    const leMatch = cond.match(/(\w+)\s*<=\s*\?/);
    if (leMatch) {
      const col = leMatch[1]!;
      const val = params[_paramIdx];
      return (row[col] as string) <= (val as string);
    }

    // Match: column != ? or column <> ?
    const neMatch = cond.match(/(\w+)\s*(?:!=|<>)\s*\?/);
    if (neMatch) {
      const col = neMatch[1]!;
      const val = params[_paramIdx];
      return row[col] !== val;
    }

    // Match: column IS NULL
    const isNullMatch = cond.match(/(\w+)\s+IS\s+NULL/i);
    if (isNullMatch) {
      const col = isNullMatch[1]!;
      return row[col] === null || row[col] === undefined;
    }

    // Match: column IS NOT NULL
    const isNotNullMatch = cond.match(/(\w+)\s+IS\s+NOT\s+NULL/i);
    if (isNotNullMatch) {
      const col = isNotNullMatch[1]!;
      return row[col] !== null && row[col] !== undefined;
    }

    // No match — return true (don't filter)
    return true;
  }

  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const data = JSON.parse(stored) as Record<string, Row[]>;
        this.tables = new Map(Object.entries(data));
      }
    } catch {
      // localStorage not available or parse error — start fresh
    }
  }

  private saveToStorage(): void {
    try {
      const data: Record<string, Row[]> = {};
      for (const [key, value] of this.tables) {
        data[key] = value;
      }
      localStorage.setItem(this.storageKey, JSON.stringify(data));
    } catch {
      // localStorage not available — that's fine for in-memory use
    }
  }
}

export default BrowserDatabase;
