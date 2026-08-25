/**
 * session.js — Authentication and session management service (Prompt 2.8).
 *
 * Enforces strict security constraints (docs/api-contract.md §8):
 * - Access tokens live in-memory ONLY (never in localStorage or sessionStorage).
 * - Relies on the HttpOnly refresh cookie for session persistence across page refreshes.
 * - Proactively refreshes the access token 60s before expiry.
 * - Broadcasts auth state to appStore for router guards and shell components.
 */

import { api, setAccessToken, clearAccessToken, refreshSession } from '../core/api.js';
import { appStore } from '../state/appStore.js';
import { initPermissions, clearPermissions } from './permissions.js';

let refreshTimer = null;
let currentUser = null;

/**
 * Decodes standard JWT payload without external libraries.
 */
function decodeJwtPayload(token) {
  try {
    const base64Url = token.split('.')[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const jsonPayload = decodeURIComponent(
      atob(base64)
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join('')
    );
    return JSON.parse(jsonPayload);
  } catch {
    return null;
  }
}

/**
 * Schedules proactive token refresh 60 seconds before token expiration.
 */
function scheduleProactiveRefresh(accessToken) {
  if (refreshTimer) clearTimeout(refreshTimer);

  const payload = decodeJwtPayload(accessToken);
  const expSeconds = payload?.exp;
  if (!expSeconds) return;

  const expiresInMs = expSeconds * 1000 - Date.now();
  const refreshInMs = Math.max(expiresInMs - 60_000, 10_000); // 60s before expiry, min 10s

  refreshTimer = setTimeout(async () => {
    try {
      const data = await refreshSession();
      if (data?.access_token) {
        setAccessToken(data.access_token);
        if (data.user) {
          currentUser = data.user;
        }
        scheduleProactiveRefresh(data.access_token);
        await initPermissions();
      }
    } catch {
      // Proactive refresh failed; next API call will trigger reactive refresh via api.js
    }
  }, refreshInMs);
}

/**
 * Syncs user and permissions into appStore.
 */
function updateStoreAuth(user, permissionsList = []) {
  currentUser = user;
  const roles = user?.roles || [];
  const primaryRole = roles[0] || 'customer';

  appStore.update({
    auth: {
      isAuthenticated: Boolean(user),
      user: user || null,
      role: primaryRole,
      roles,
      permissions: permissionsList,
    },
  });
}

/**
 * Bootstraps user session on app load by attempting proactive refresh.
 */
export async function initSession() {
  try {
    // Goes through api.js's single-flight helper, not api.post('/auth/refresh'): a second
    // concurrent refresh presents an already-used token and the server revokes the session.
    const data = await refreshSession();
    if (data?.access_token && data?.user) {
      setAccessToken(data.access_token);
      scheduleProactiveRefresh(data.access_token);
      const permData = await initPermissions();
      updateStoreAuth(data.user, permData?.permissions || []);
      return { isAuthenticated: true, user: data.user };
    }
  } catch {
    // No active session cookie or invalid session
  }

  clearAccessToken();
  clearPermissions();
  updateStoreAuth(null, []);
  return { isAuthenticated: false, user: null };
}

/**
 * Logs in with mobile number or email and password.
 */
export async function loginWithPassword({ phone, email, identifier, password }) {
  try {
    const payload = {
      password,
      device_name: typeof navigator !== 'undefined' ? navigator.userAgent : 'Web Browser',
    };
    if (identifier) payload.identifier = identifier;
    if (email) payload.email = email;
    if (phone) payload.phone = phone;

    const res = await api.post(
      '/auth/login',
      payload,
      { skipAuthRedirect: true }
    );

    if (res?.data?.access_token && res?.data?.user) {
      setAccessToken(res.data.access_token);
      scheduleProactiveRefresh(res.data.access_token);
      const permData = await initPermissions();
      updateStoreAuth(res.data.user, permData?.permissions || []);
      return { success: true, user: res.data.user };
    }

    return { success: false };
  } catch (err) {
    if (err.code === 'TWO_FACTOR_REQUIRED') {
      return {
        twoFactorRequired: true,
        challengeToken: err.details?.challenge_token,
        enrolled: err.details?.enrolled,
      };
    }
    throw err;
  }
}

/**
 * Requests an OTP code to be sent to phone or email.
 */
export async function sendOtp({ phone, email, purpose = 'LOGIN' }) {
  return api.post('/auth/send-otp', {
    phone: phone || undefined,
    email: email || undefined,
    purpose,
  });
}

/**
 * Verifies OTP code and authenticates.
 */
export async function verifyOtp({ phone, email, otp, purpose = 'LOGIN' }) {
  try {
    const res = await api.post('/auth/verify-otp', {
      phone: phone || undefined,
      email: email || undefined,
      code: otp,
      purpose,
    });

    if (res?.data?.access_token && res?.data?.user) {
      setAccessToken(res.data.access_token);
      scheduleProactiveRefresh(res.data.access_token);
      const permData = await initPermissions();
      updateStoreAuth(res.data.user, permData?.permissions || []);
      return { success: true, user: res.data.user };
    }

    // REGISTER-purpose verification only marks the phone/email verified — it never issues a session
    // (registerUser doesn't set auth cookies), so `verified: true` without tokens is the correct
    // success shape here, distinct from an actual failure.
    if (res?.data?.verified) {
      return { success: false, verified: true };
    }

    return { success: false };
  } catch (err) {
    if (err.code === 'TWO_FACTOR_REQUIRED') {
      return {
        twoFactorRequired: true,
        challengeToken: err.details?.challenge_token,
        enrolled: err.details?.enrolled,
      };
    }
    throw err;
  }
}

/**
 * Registers a new user account with phone or email.
 */
export async function register({ phone, email, role, password, name }) {
  return api.post('/auth/register', {
    phone: phone || undefined,
    email: email || undefined,
    role,
    password,
    full_name: name || undefined,
  });
}

/**
 * Fetches TOTP setup secret for staff enrollment.
 */
export async function setupTwoFactor({ challengeToken }) {
  return api.post('/auth/2fa/setup', { challenge_token: challengeToken }, { skipAuthRedirect: true });
}

/**
 * Verifies TOTP code during 2FA challenge.
 */
export async function completeTwoFactor({ challengeToken, code }) {
  const res = await api.post(
    '/auth/2fa/verify',
    { code, challenge_token: challengeToken },
    { skipAuthRedirect: true }
  );

  if (res?.data?.access_token && res?.data?.user) {
    setAccessToken(res.data.access_token);
    scheduleProactiveRefresh(res.data.access_token);
    const permData = await initPermissions();
    updateStoreAuth(res.data.user, permData?.permissions || []);
    return { success: true, user: res.data.user };
  }

  return { success: false };
}

/**
 * Logs out the active user and clears in-memory state.
 */
export async function logout() {
  if (refreshTimer) clearTimeout(refreshTimer);
  refreshTimer = null;

  try {
    await api.post('/auth/logout');
  } catch {
    // Ignore server error on logout
  }

  clearAccessToken();
  clearPermissions();
  currentUser = null;
  updateStoreAuth(null, []);
}

export function getCurrentUser() {
  return currentUser;
}

export function isUserAuthenticated() {
  return Boolean(currentUser);
}
