/**
 * staffRoles.js — what counts as a "staff" role, and the copy the Staff page shows for each.
 *
 * WHY a level threshold instead of a hard-coded list of role keys: roles.level is the platform's own
 * ordering (002_rbac.sql: 100 super_admin … 10 customer), and Prompt 3.2's `staff.role.create` lets
 * a Super Admin add roles at runtime. Any role at or above STAFF_MIN_ROLE_LEVEL is staff, so a new
 * "Support Lead" role shows up in the roster and the role picker with no code change. The seeded
 * customer-facing roles (supplier/saler 20, customer 10) sit below the line.
 */

export const STAFF_MIN_ROLE_LEVEL = 50;

/** super_admin (100) and admin (80): roles the page flags with a "grant sparingly" warning. */
export const STAFF_PRIVILEGED_MIN_LEVEL = 80;

/**
 * Explanatory copy for the role picker, keyed by role key. Presentation only — the roles table has
 * no description column, and inventing one just for a tooltip is not worth a migration. A role that
 * is not listed here simply renders without an explainer.
 */
export const STAFF_ROLE_DESCRIPTIONS = Object.freeze({
  super_admin: {
    en: 'Unrestricted control of every module, permission and setting.',
    bn: 'সব মডিউল, পারমিশন ও সেটিংসের ওপর পূর্ণ নিয়ন্ত্রণ।',
  },
  admin: {
    en: 'Runs day-to-day operations; cannot change roles or platform policy.',
    bn: 'দৈনন্দিন পরিচালনা করেন; রোল বা প্ল্যাটফর্ম নীতি বদলাতে পারেন না।',
  },
  moderator: {
    en: 'Trust & safety: reviews, disputes, restrictions and approvals.',
    bn: 'ট্রাস্ট ও সেফটি: রিভিউ, বিরোধ, বিধিনিষেধ ও অনুমোদন।',
  },
  editor: {
    en: 'Catalog and campaign content; no access to money or people.',
    bn: 'ক্যাটালগ ও ক্যাম্পেইন কনটেন্ট; অর্থ বা ব্যবহারকারীর ওপর কোনো অ্যাক্সেস নেই।',
  },
});
