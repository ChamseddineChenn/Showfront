'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  ReactNode,
} from 'react';
import { useRouter } from 'next/navigation';
import { authApi } from '../api/auth';
import {
  User,
  AuthContextType,
  UserType,
  OrganizerSignupData,
} from '../types/auth.types';

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const currentUser = await authApi.getCurrentUser();
      setUser(currentUser);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  // Go back to where the user came from, otherwise to their role's home
  const redirectAfterAuth = (loggedInUser: User, redirectTo?: string) => {
    if (redirectTo) {
      router.push(redirectTo);
    } else if (loggedInUser.userType === UserType.ADMIN) {
      router.push('/admin/');
    } else {
      router.push('/');
    }
    router.refresh();
  };

  const login = async (
    email: string,
    password: string,
    redirectTo?: string,
  ) => {
    try {
      const response = await authApi.login(email, password);
      setUser(response.user);
      redirectAfterAuth(response.user, redirectTo);
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Login failed');
    }
  };

  const loginWithGoogle = async (idToken: string, redirectTo?: string) => {
    try {
      const response = await authApi.loginWithGoogle(idToken);
      setUser(response.user);
      redirectAfterAuth(response.user, redirectTo);
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Google login failed');
    }
  };

  const loginWithFacebook = async (accessToken: string, redirectTo?: string) => {
    try {
      const response = await authApi.loginWithFacebook(accessToken);
      setUser(response.user);
      redirectAfterAuth(response.user, redirectTo);
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Facebook login failed');
    }
  };

  const signup = async (
    email: string,
    password: string,
    redirectTo?: string,
  ) => {
    try {
      const response = await authApi.signup(email, password);
      setUser(response.user);
      router.push(redirectTo || '/');
      router.refresh();
    } catch (error: any) {
      throw new Error(error.response?.data?.message || 'Signup failed');
    }
  };

  const signupOrganizer = async (data: OrganizerSignupData) => {
    try {
      const response = await authApi.signupOrganizer(data);
      setUser(response.user);
      router.push('/');
      router.refresh();
    } catch (error: any) {
      throw new Error(
        error.response?.data?.message || 'Organizer signup failed',
      );
    }
  };

  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      router.push('/');
      router.refresh();
    }
  };

  const refreshAuth = async () => {
    await checkAuth();
  };

  const isAdmin = () => user?.userType === UserType.ADMIN;
  const isOrganizer = () => user?.userType === UserType.ORGANIZER;
  const isRegularUser = () =>
    user?.userType === UserType.USER || !user?.userType;

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        loginWithGoogle,
        loginWithFacebook,
        signup,
        signupOrganizer,
        logout,
        refreshAuth,
        isAdmin,
        isOrganizer,
        isRegularUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
