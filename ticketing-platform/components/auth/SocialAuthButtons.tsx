'use client';

import { useState } from 'react';
import { useGoogleLogin } from '@react-oauth/google';
import FacebookLogin from '@greatsumini/react-facebook-login';
import { useAuth } from '@/lib/hooks/useAuth';

interface SocialAuthButtonsProps {
  mode?: 'login' | 'signup';
  redirectTo?: string;
  onError?: (error: string) => void;
}

const googleClientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

const googleButtonClass =
  'w-full flex items-center justify-center gap-3 px-4 py-3 border border-stone-300 rounded-xl bg-white hover:bg-stone-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed';

export function SocialAuthButtons({
  mode = 'login',
  redirectTo,
  onError,
}: SocialAuthButtonsProps) {
  const { loginWithFacebook } = useAuth();
  const [isGoogleLoading, setIsGoogleLoading] = useState(false);
  const [isFacebookLoading, setIsFacebookLoading] = useState(false);

  const handleFacebookSuccess = async (response: any) => {
    setIsFacebookLoading(true);
    try {
      if (!response.accessToken) {
        throw new Error('No access token received from Facebook');
      }

      await loginWithFacebook(response.accessToken, redirectTo);
    } catch (error: any) {
      console.error('Facebook login error:', error);
      onError?.(error.message || 'Facebook login failed');
    } finally {
      setIsFacebookLoading(false);
    }
  };

  const actionText = mode === 'login' ? 'Sign in' : 'Sign up';

  return (
    <div className="space-y-3">
      {/* Google Sign In Button */}
      {googleClientId ? (
        <GoogleLoginButton
          actionText={actionText}
          redirectTo={redirectTo}
          disabled={isFacebookLoading}
          isLoading={isGoogleLoading}
          setIsLoading={setIsGoogleLoading}
          onError={onError}
        />
      ) : (
        // Google's script throws if initialised without a client ID
        <button
          type="button"
          disabled
          title="Google sign-in is not available yet"
          className={googleButtonClass}
        >
          <GoogleIcon />
          <span className="text-stone-700 font-medium text-sm sm:text-base">
            {actionText} with Google (coming soon)
          </span>
        </button>
      )}

      {/* Facebook Sign In Button */}
      <FacebookLogin
        appId={process.env.NEXT_PUBLIC_FACEBOOK_APP_ID || ''}
        onSuccess={handleFacebookSuccess}
        onFail={(error) => {
          console.error('Facebook Sign-In error:', error);
          onError?.('Facebook login failed. Please try again.');
        }}
        render={({ onClick }) => (
          <button
            type="button"
            onClick={onClick}
            disabled={isGoogleLoading || isFacebookLoading}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-stone-300 rounded-xl bg-[#1877F2] hover:bg-[#166FE5] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isFacebookLoading ? (
              <svg className="animate-spin h-5 w-5 text-white" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
              </svg>
            ) : (
              <svg className="w-5 h-5 text-white" viewBox="0 0 24 24" fill="currentColor">
                <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
              </svg>
            )}
            <span className="text-white font-medium text-sm sm:text-base">
              {isFacebookLoading ? 'Signing in...' : `${actionText} with Facebook`}
            </span>
          </button>
        )}
      />
    </div>
  );
}

interface GoogleLoginButtonProps {
  actionText: string;
  redirectTo?: string;
  disabled: boolean;
  isLoading: boolean;
  setIsLoading: (loading: boolean) => void;
  onError?: (error: string) => void;
}

function GoogleLoginButton({
  actionText,
  redirectTo,
  disabled,
  isLoading,
  setIsLoading,
  onError,
}: GoogleLoginButtonProps) {
  const { loginWithGoogle } = useAuth();

  const googleLogin = useGoogleLogin({
    onSuccess: async (tokenResponse) => {
      setIsLoading(true);
      try {
        // For implicit flow, we use the access token directly
        // The backend will verify this with Google
        await loginWithGoogle(tokenResponse.access_token, redirectTo);
      } catch (error: any) {
        console.error('Google login error:', error);
        onError?.(error.message || 'Google login failed');
      } finally {
        setIsLoading(false);
      }
    },
    onError: (error) => {
      console.error('Google OAuth error:', error);
      onError?.('Google login failed. Please try again.');
    },
    flow: 'implicit',
  });

  return (
    <button
      type="button"
      onClick={() => googleLogin()}
      disabled={isLoading || disabled}
      className={googleButtonClass}
    >
      {isLoading ? (
        <svg className="animate-spin h-5 w-5 text-stone-600" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
        </svg>
      ) : (
        <GoogleIcon />
      )}
      <span className="text-stone-700 font-medium text-sm sm:text-base">
        {isLoading ? 'Signing in...' : `${actionText} with Google`}
      </span>
    </button>
  );
}

function GoogleIcon() {
  return (
    <svg className="w-5 h-5" viewBox="0 0 24 24">
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}
