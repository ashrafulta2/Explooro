/**
 * audit.js — audit_logs helper (Prompt 2.3 / 2.7).
 *
 * Delegates to the Audit Service (Prompt 2.7) so that all audit writers automatically
 * benefit from context extraction, recursive sensitive data redaction, and hash chaining.
 */

import { record } from '../services/audit.service.js';

export async function writeAudit(db, params) {
  return record(db, params);
}
