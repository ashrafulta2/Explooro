/**
 * migrationChecksum.js — how migrate.js decides whether an applied migration file changed.
 *
 * WHY line endings are forgiven: on Windows with core.autocrlf=true, git checked .sql files out
 * with CRLF until .gitattributes pinned them to LF (2026-10-08). A database migrated from that
 * checkout stored CRLF hashes; the same file is now LF on disk, so the runner refused to start even
 * though not one character of SQL changed. Only the line endings are forgiven: any other edit still
 * refuses, because applied migrations are immutable.
 */

import { createHash } from 'node:crypto';

export function checksumOf(sql) {
  return createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * 'same'         the stored hash matches the file's bytes.
 * 'line-endings' it matches the same file with LF or CRLF line endings; nothing else differs.
 * 'changed'      the SQL itself was edited.
 */
export function compareApplied(storedChecksum, sql) {
  if (storedChecksum === checksumOf(sql)) return 'same';
  const lf = sql.replace(/\r\n/g, '\n');
  if (storedChecksum === checksumOf(lf) || storedChecksum === checksumOf(lf.replace(/\n/g, '\r\n'))) {
    return 'line-endings';
  }
  return 'changed';
}
