/**
 * Generates server/src/db/seeds/002_dev_users.sql — one real user per role, argon2id-hashed
 * (Prompt 2.2 requirement 5). Credentials are documented under README's "Development only"
 * heading; this script is how they were produced, and how to regenerate them if ever rotated.
 *
 * Run:  node scripts/generate-dev-user-seed.mjs
 *
 * The moderator seeded here intentionally receives no user_permission_overrides — this migration
 * phase never seeds that table for anyone — so it authorises purely off role_permissions, letting
 * the locked-state UI (docs/ia-sitemap.md §5) be tested against a real zero-delegation account.
 */
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { hashPassword } from '../server/src/lib/password.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = path.join(__dirname, '../server/src/db/seeds/002_dev_users.sql');

export const DEV_PASSWORD = 'Explooro@Dev2026';

const DEV_USERS = [
  { role: 'super_admin', phone: '+8801700000001', name: 'Dev Super Admin' },
  { role: 'admin', phone: '+8801700000002', name: 'Dev Admin' },
  { role: 'moderator', phone: '+8801700000003', name: 'Dev Moderator (zero delegated permissions)' },
  { role: 'editor', phone: '+8801700000004', name: 'Dev Editor' },
  { role: 'supplier', phone: '+8801700000005', name: 'Dev Supplier' },
  { role: 'saler', phone: '+8801700000006', name: 'Dev Saler' },
  { role: 'customer', phone: '+8801700000007', name: 'Dev Customer' },
];

function sqlString(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

async function main() {
  const passwordHash = await hashPassword(DEV_PASSWORD);

  const lines = [];
  lines.push('-- 002_dev_users.sql (Prompt 2.2)');
  lines.push('-- GENERATED — do not hand-edit. Regenerate with:');
  lines.push('--   node scripts/generate-dev-user-seed.mjs');
  lines.push('-- DEVELOPMENT ONLY. One user per role, all sharing the password documented in');
  lines.push('-- README under "Development only — seeded accounts". Never run against production.');
  lines.push('-- Idempotent: every INSERT is ON CONFLICT DO NOTHING, safe to re-run.');
  lines.push('');

  lines.push('INSERT INTO users (ref, phone, email, password_hash, is_phone_verified, is_email_verified, status) VALUES');
  lines.push(
    DEV_USERS.map((u, i) => {
      const ref = `USR-DEV-${u.role.toUpperCase().replace(/_/g, '-')}`;
      const email = `${u.role}@dev.explooro.local`;
      const row = [
        sqlString(ref),
        sqlString(u.phone),
        sqlString(email),
        sqlString(passwordHash),
        'true',
        'true',
        sqlString('ACTIVE'),
      ].join(', ');
      return `  (${row})` + (i === DEV_USERS.length - 1 ? '' : ',');
    }).join('\n')
  );
  lines.push('ON CONFLICT (phone) DO NOTHING;');
  lines.push('');

  lines.push('INSERT INTO user_profiles (user_id, full_name, display_name)');
  lines.push('SELECT u.id, x.full_name, x.full_name');
  lines.push('FROM (VALUES');
  lines.push(
    DEV_USERS.map((u, i) => `  (${sqlString(u.phone)}, ${sqlString(u.name)})` + (i === DEV_USERS.length - 1 ? '' : ',')).join('\n')
  );
  lines.push(') AS x(phone, full_name)');
  lines.push('JOIN users u ON u.phone = x.phone');
  lines.push('ON CONFLICT (user_id) DO NOTHING;');
  lines.push('');

  lines.push('INSERT INTO user_roles (user_id, role_id)');
  lines.push('SELECT u.id, r.id');
  lines.push('FROM (VALUES');
  lines.push(
    DEV_USERS.map((u, i) => `  (${sqlString(u.phone)}, ${sqlString(u.role)})` + (i === DEV_USERS.length - 1 ? '' : ',')).join('\n')
  );
  lines.push(') AS x(phone, role_key)');
  lines.push('JOIN users u ON u.phone = x.phone');
  lines.push('JOIN roles r ON r.key = x.role_key');
  lines.push('ON CONFLICT (user_id, role_id) DO NOTHING;');
  lines.push('');

  await writeFile(OUTPUT_PATH, lines.join('\n'), 'utf8');
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`  ${DEV_USERS.length} dev users, password hash regenerated (argon2id, unique salt)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
