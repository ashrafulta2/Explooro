/**
 * Mock Auth Handlers — enables full login, OTP, registration, session, and permission
 * preview in development when running in mock mode (VITE_API_MODE=mock).
 */
import catalog from '../../../../docs/permission-catalog.json' with { type: 'json' };

const DEV_USERS = {
  '+8801700000001': { id: 'usr-dev-1', ref: 'USR-DEV-SUPER-ADMIN', name: 'Dev Super Admin', role: 'super_admin', email: 'super_admin@dev.explooro.local' },
  '+8801700000002': { id: 'usr-dev-2', ref: 'USR-DEV-ADMIN', name: 'Dev Admin', role: 'admin', email: 'admin@dev.explooro.local' },
  '+8801700000003': { id: 'usr-dev-3', ref: 'USR-DEV-MODERATOR', name: 'Dev Moderator', role: 'moderator', email: 'moderator@dev.explooro.local' },
  '+8801700000004': { id: 'usr-dev-4', ref: 'USR-DEV-EDITOR', name: 'Dev Editor', role: 'editor', email: 'editor@dev.explooro.local' },
  '+8801700000005': { id: 'usr-dev-5', ref: 'USR-DEV-SUPPLIER', name: 'Dev Supplier', role: 'supplier', email: 'supplier@dev.explooro.local' },
  '+8801700000006': { id: 'usr-dev-6', ref: 'USR-DEV-SALER', name: 'Dev Saler', role: 'saler', email: 'saler@dev.explooro.local' },
  '+8801700000007': { id: 'usr-dev-7', ref: 'USR-DEV-CUSTOMER', name: 'Dev Customer', role: 'customer', email: 'customer@dev.explooro.local' },
};

// WHY: without persistence the "session" is a module-level variable that dies on every page
// reload, so opening any /account/* URL directly, refreshing, or restoring a tab bounced the
// developer to the login screen. sessionStorage keeps the mock login alive for the tab's
// lifetime (cleared on tab close and by POST /auth/logout) — close enough to a real refresh-cookie
// session for local work, and never touches a real backend.
const MOCK_SESSION_KEY = 'explooro.mock.session';

function loadMockUser() {
  try {
    const raw = sessionStorage.getItem(MOCK_SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function persistMockUser(user) {
  try {
    if (user) sessionStorage.setItem(MOCK_SESSION_KEY, JSON.stringify(user));
    else sessionStorage.removeItem(MOCK_SESSION_KEY);
  } catch {
    /* sessionStorage unavailable (private mode, etc.) — fall back to in-memory only */
  }
}

let currentMockUser = loadMockUser();

/**
 * Read-only accessor for the mock session, used by other mock drivers that need to know who is
 * signed in (chat.js resolves its `SELF` sentinel through this). Kept here rather than importing
 * services/session.js so the mock layer never depends on the app layer it is mocking for.
 */
export function getMockSessionUser() {
  return currentMockUser;
}

function setCurrentMockUser(user) {
  currentMockUser = user;
  persistMockUser(user);
}

function createMockJwt(user) {
  const header = btoa(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).replace(/=/g, '');
  const payload = btoa(
    JSON.stringify({
      sub: user.id,
      phone: user.phone,
      roles: user.roles,
      exp: Math.floor(Date.now() / 1000) + 7200, // 2 hours
    })
  ).replace(/=/g, '');
  const sig = 'mock_signature';
  return `${header}.${payload}.${sig}`;
}

function getPermissionsForRoles(roles = []) {
  const set = new Set();
  for (const perm of catalog.permissions) {
    if (perm.default_roles && roles.some((r) => perm.default_roles.includes(r))) {
      set.add(perm.key);
    }
  }
  return Array.from(set);
}

function resolveUserByIdentifier(identifier) {
  const norm = identifier ? identifier.trim() : '';
  // Check by phone or email in DEV_USERS
  for (const [phone, dev] of Object.entries(DEV_USERS)) {
    if (phone === norm || dev.email.toLowerCase() === norm.toLowerCase()) {
      return {
        id: dev.id,
        ref: dev.ref,
        phone,
        email: dev.email,
        name: dev.name,
        roles: [dev.role],
      };
    }
  }
  const isEmail = norm.includes('@');
  return {
    id: `usr-mock-${Date.now()}`,
    ref: `USR-MOCK-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
    phone: isEmail ? null : (norm || '+8801700000007'),
    email: isEmail ? norm : 'user@example.com',
    name: 'Mock User',
    roles: ['customer'],
  };
}

export default [
  // 1. Password Login
  {
    method: 'POST',
    path: '/auth/login',
    handler({ body }) {
      const identifier = body?.identifier || body?.email || body?.phone?.trim();
      const password = body?.password;

      if (!identifier || !password) {
        return {
          status: 400,
          body: {
            error: {
              code: 'VALIDATION_ERROR',
              message_en: 'Credentials and password are required.',
              message_bn: 'মোবাইল নম্বর/ইমেইল এবং পাসওয়ার্ড আবশ্যক।',
            },
          },
        };
      }

      const user = resolveUserByIdentifier(identifier);
      setCurrentMockUser(user);
      const accessToken = createMockJwt(user);

      return {
        status: 200,
        body: {
          data: {
            access_token: accessToken,
            user: {
              id: user.id,
              ref: user.ref,
              phone: user.phone,
              email: user.email,
              name: user.name,
              roles: user.roles,
            },
          },
        },
      };
    },
  },

  // 2. Refresh Token
  {
    method: 'POST',
    path: '/auth/refresh',
    handler() {
      if (!currentMockUser) {
        return {
          status: 401,
          body: {
            error: {
              code: 'UNAUTHENTICATED',
              message_en: 'No active session.',
              message_bn: 'কোনো সক্রিয় সেশন নেই।',
            },
          },
        };
      }

      const accessToken = createMockJwt(currentMockUser);
      return {
        status: 200,
        body: {
          data: {
            access_token: accessToken,
            user: currentMockUser,
          },
        },
      };
    },
  },

  // 3. User Permissions (/me/permissions)
  {
    method: 'GET',
    path: '/me/permissions',
    handler() {
      const roles = currentMockUser?.roles || ['customer'];
      const permissions = getPermissionsForRoles(roles);

      return {
        status: 200,
        body: {
          data: {
            permissions,
            roles,
            sources: {},
            grants: [],
            jit_windows: [],
            restrictions: [],
          },
        },
      };
    },
  },

  // 4. Send OTP
  {
    method: 'POST',
    path: '/auth/send-otp',
    handler({ body }) {
      const target = body?.email || body?.phone;
      return {
        status: 200,
        body: {
          data: {
            phone: body?.phone,
            email: body?.email,
            message: `OTP sent to ${target} (use 123456 in dev)`,
            expires_in: 300,
          },
        },
      };
    },
  },

  // 5. Verify OTP
  {
    method: 'POST',
    path: '/auth/verify-otp',
    handler({ body }) {
      const identifier = body?.email || body?.phone?.trim();
      const user = resolveUserByIdentifier(identifier);
      setCurrentMockUser(user);
      const accessToken = createMockJwt(user);

      if (body?.purpose === 'REGISTER') {
        return {
          status: 200,
          body: {
            data: {
              verified: true,
            },
          },
        };
      }

      return {
        status: 200,
        body: {
          data: {
            access_token: accessToken,
            user,
          },
        },
      };
    },
  },

  // 6. Register
  {
    method: 'POST',
    path: '/auth/register',
    handler({ body }) {
      const phone = body?.phone?.trim() || null;
      const email = body?.email?.trim() || (phone ? null : 'user@explooro.local');
      const role = body?.role || 'customer';
      const name = body?.full_name || body?.name || 'New User';

      const user = {
        id: `usr-${Date.now()}`,
        ref: `USR-REG-${Math.random().toString(36).substring(2, 7).toUpperCase()}`,
        phone,
        email: email || `${role}@explooro.local`,
        name,
        roles: [role],
      };

      setCurrentMockUser(user);
      const accessToken = createMockJwt(user);

      return {
        status: 201,
        body: {
          data: {
            access_token: accessToken,
            user,
          },
        },
      };
    },
  },

  // 7. Logout
  {
    method: 'POST',
    path: '/auth/logout',
    handler() {
      setCurrentMockUser(null);
      return {
        status: 200,
        body: {
          data: { success: true },
        },
      };
    },
  },

  // 8. 2FA Setup
  {
    method: 'POST',
    path: '/auth/2fa/setup',
    handler() {
      return {
        status: 200,
        body: {
          data: {
            secret: 'JBSWY3DPEHPK3PXP',
            otpauth_uri: 'otpauth://totp/Explooro:staff?secret=JBSWY3DPEHPK3PXP&issuer=Explooro',
          },
        },
      };
    },
  },

  // 9. 2FA Verify
  {
    method: 'POST',
    path: '/auth/2fa/verify',
    handler() {
      const user = currentMockUser || resolveUserByPhone('+8801700000002');
      setCurrentMockUser(user);
      const accessToken = createMockJwt(user);
      return {
        status: 200,
        body: {
          data: {
            access_token: accessToken,
            user,
          },
        },
      };
    },
  },
];
