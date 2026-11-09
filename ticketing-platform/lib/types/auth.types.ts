export enum UserType {
  USER = 'User',
  ORGANIZER = 'Organizer',
  ADMIN = 'Admin',
}

export enum AuthProvider {
  LOCAL = 'local',
  GOOGLE = 'google',
  FACEBOOK = 'facebook',
}

export interface User {
  id: string;
  email: string;
  userType: UserType;
  emailVerified: boolean;
  // OAuth-related fields
  firstName?: string;
  lastName?: string;
  avatar?: string;
  authProvider?: AuthProvider;
  // Type-specific fields
  organizationName?: string;
  phone?: string;
  isVerifiedOrganizer?: boolean;
  adminLevel?: string;
  permissions?: string[];
}

export interface AuthResponse {
  success: boolean;
  message: string;
  user: User;
  data?: {
    accessToken: string;
    refreshToken: string;
  };
}

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (
    email: string,
    password: string,
    redirectTo?: string,
  ) => Promise<void>;
  loginWithGoogle: (accessToken: string, redirectTo?: string) => Promise<void>;
  loginWithFacebook: (
    accessToken: string,
    redirectTo?: string,
  ) => Promise<void>;
  signup: (
    email: string,
    password: string,
    redirectTo?: string,
  ) => Promise<void>;
  signupOrganizer: (data: OrganizerSignupData) => Promise<void>;
  logout: () => Promise<void>;
  refreshAuth: () => Promise<void>;
  isAdmin: () => boolean;
  isOrganizer: () => boolean;
  isRegularUser: () => boolean;
}

export interface OrganizerSignupData {
  email: string;
  password: string;
  organizationName: string;
  phone: string;
  address?: string;
  website?: string;
  description?: string;
}
