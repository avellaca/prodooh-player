/**
 * Auth contracts — shared user authentication types between admin panel and backend.
 */

// ─── User Roles ──────────────────────────────────────────────────────────────

export type UserRole = 'super_admin' | 'tenant_admin' | 'trafficker';

// ─── Authenticated User ──────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  tenant_id: string | null;
  created_at: string;
}

// ─── Auth Requests/Responses ─────────────────────────────────────────────────

export interface LoginCredentials {
  email: string;
  password: string;
}

export interface LoginResponse {
  token: string;
  user: AuthUser;
}
