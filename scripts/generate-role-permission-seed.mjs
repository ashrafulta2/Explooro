/**
 * Generates server/src/db/seeds/001_roles_permissions.sql from docs/permission-catalog.json
 * (Prompt 2.2 requirement 4: "write a small loader or generate the INSERTs").
 *
 * Run:  node scripts/generate-role-permission-seed.mjs
 *
 * The seed file itself stays plain, dependency-free SQL — no runtime JSON parsing inside
 * Postgres — so it can be applied by the equally dependency-free seed.js runner. Re-run this
 * script and commit the regenerated .sql whenever permission-catalog.json changes.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(__dirname, '../docs/permission-catalog.json');
const OUTPUT_PATH = path.join(__dirname, '../server/src/db/seeds/001_roles_permissions.sql');

function sqlString(value) {
  if (value === null || value === undefined) return 'NULL';
  return `'${String(value).replace(/'/g, "''")}'`;
}

function sqlBool(value) {
  return value ? 'true' : 'false';
}

async function main() {
  const catalog = JSON.parse(await readFile(CATALOG_PATH, 'utf8'));
  const { roles, permissions } = catalog;

  const lines = [];
  lines.push('-- 001_roles_permissions.sql (Prompt 2.2)');
  lines.push('-- GENERATED — do not hand-edit. Regenerate with:');
  lines.push('--   node scripts/generate-role-permission-seed.mjs');
  lines.push(`-- Source: docs/permission-catalog.json v${catalog.version} (${permissions.length} permissions, ${roles.length} roles).`);
  lines.push('-- Idempotent: every INSERT is ON CONFLICT DO NOTHING, safe to re-run.');
  lines.push('');

  lines.push('INSERT INTO roles (key, label_en, label_bn, level, is_system) VALUES');
  lines.push(
    roles
      .map(
        (r, i) =>
          `  (${sqlString(r.key)}, ${sqlString(r.label_en)}, ${sqlString(r.label_bn)}, ${r.level}, ${sqlBool(r.is_system)})` +
          (i === roles.length - 1 ? '' : ',')
      )
      .join('\n')
  );
  lines.push('ON CONFLICT (key) DO NOTHING;');
  lines.push('');

  lines.push('INSERT INTO permissions (key, domain, label_en, label_bn, plain_en, plain_bn, risk_tier, delegable, approval_mode) VALUES');
  lines.push(
    permissions
      .map((p, i) => {
        const row = [
          sqlString(p.key),
          sqlString(p.domain),
          sqlString(p.label_en),
          sqlString(p.label_bn),
          sqlString(p.plain_en ?? null),
          sqlString(p.plain_bn ?? null),
          sqlString(p.risk_tier),
          sqlBool(p.delegable),
          sqlString(p.approval_mode ?? 'approve_before'),
        ].join(', ');
        return `  (${row})` + (i === permissions.length - 1 ? '' : ',');
      })
      .join('\n')
  );
  lines.push('ON CONFLICT (key) DO NOTHING;');
  lines.push('');

  const pairs = permissions.flatMap((p) => (p.default_roles ?? []).map((roleKey) => [roleKey, p.key]));
  lines.push('INSERT INTO role_permissions (role_id, permission_key)');
  lines.push('SELECT r.id, x.permission_key');
  lines.push('FROM (VALUES');
  lines.push(
    pairs.map(([roleKey, permKey], i) => `  (${sqlString(roleKey)}, ${sqlString(permKey)})` + (i === pairs.length - 1 ? '' : ',')).join('\n')
  );
  lines.push(') AS x(role_key, permission_key)');
  lines.push('JOIN roles r ON r.key = x.role_key');
  lines.push('ON CONFLICT DO NOTHING;');
  lines.push('');

  await writeFile(OUTPUT_PATH, lines.join('\n'), 'utf8');
  console.log(`Wrote ${OUTPUT_PATH}`);
  console.log(`  ${roles.length} roles, ${permissions.length} permissions, ${pairs.length} role_permissions rows`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
