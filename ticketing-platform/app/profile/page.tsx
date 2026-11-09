'use client';

import { useState, useEffect } from 'react';
import { useAuth } from '@/lib/hooks/useAuth';
import { usersApi, ProfileUpdateData } from '@/lib/api/users';
import Link from 'next/link';
import { UserType } from '@/lib/types/auth.types';

export default function ProfilePage() {
  const { user, loading: authLoading, refreshAuth } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [formData, setFormData] = useState<ProfileUpdateData>({});
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (user) {
      loadProfile();
    }
  }, [user]);

  const loadProfile = async () => {
    try {
      setLoading(true);
      const profileData = await usersApi.getMyProfile();
      setProfile(profileData);
      setFormData({
        email: profileData.email,
        organizationName: profileData.organizationName,
        phone: profileData.phone,
        address: profileData.address,
        website: profileData.website,
        description: profileData.description,
        businessLicense: profileData.businessLicense,
        organizationEstablishedDate: profileData.organizationEstablishedDate,
      });
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load profile');
    } finally {
      setLoading(false);
    }
  };

  const handleInputChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value,
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setIsSaving(true);

    try {
      // Only send changed fields
      const updates: ProfileUpdateData = {};
      Object.keys(formData).forEach((key) => {
        const formValue = formData[key as keyof ProfileUpdateData];
        const profileValue = (profile as any)?.[key];
        if (formValue !== profileValue) {
          updates[key as keyof ProfileUpdateData] = formValue as any;
        }
      });

      if (Object.keys(updates).length === 0) {
        setSuccess('No changes to save');
        setEditing(false);
        setIsSaving(false);
        return;
      }

      const response = await usersApi.updateMyProfile(updates);
      setSuccess(response.message);
      setEditing(false);

      // Refresh profile data
      await loadProfile();

      // Refresh auth context if email changed
      if (updates.email) {
        await refreshAuth();
      }
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  if (authLoading || loading) {
    return (
      <div className="min-h-screen bg-stone-50 flex flex-col">
        <header className="bg-white/95 backdrop-blur-sm border-b border-stone-200 sticky top-0 z-50">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex justify-between items-center h-16 sm:h-20">
              <Link href="/" className="flex items-center gap-2 sm:gap-3">
                <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20">
                  <span className="text-white text-base sm:text-lg font-bold">
                    G
                  </span>
                </div>
                <div>
                  <h1 className="text-base sm:text-xl font-bold text-stone-900 tracking-tight">
                    Showfront
                  </h1>
                  <p className="text-xs text-stone-500 -mt-0.5 hidden sm:block">
                    Events & Experiences
                  </p>
                </div>
              </Link>
              <Link
                href="/"
                className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900 transition font-medium text-sm"
              >
                <svg
                  className="w-4 h-4"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M10 19l-7-7m0 0l7-7m-7 7h18"
                  />
                </svg>
                <span className="hidden sm:inline">Back to Home</span>
                <span className="sm:hidden">Back</span>
              </Link>
            </div>
          </div>
        </header>
        <div className="flex-1 flex items-center justify-center p-4">
          <div className="w-12 h-12 border-4 border-amber-500 border-t-transparent rounded-full animate-spin"></div>
        </div>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-stone-50 flex items-center justify-center">
        <p className="text-stone-600">Failed to load profile</p>
      </div>
    );
  }

  const isOrganizer = user?.userType === UserType.ORGANIZER;
  const isAdmin = user?.userType === UserType.ADMIN;

  return (
    <div className="min-h-screen bg-stone-50 flex flex-col">
      {/* Header */}
      <header className="bg-white/95 backdrop-blur-sm border-b border-stone-200 sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-16 sm:h-20">
            <Link href="/" className="flex items-center gap-2 sm:gap-3">
              <div className="w-8 h-8 sm:w-10 sm:h-10 bg-gradient-to-br from-amber-500 to-amber-600 rounded-xl flex items-center justify-center shadow-lg shadow-amber-500/20">
                <span className="text-white text-base sm:text-lg font-bold">
                  G
                </span>
              </div>
              <div>
                <h1 className="text-base sm:text-xl font-bold text-stone-900 tracking-tight">
                  Showfront
                </h1>
                <p className="text-xs text-stone-500 -mt-0.5 hidden sm:block">
                  Events & Experiences
                </p>
              </div>
            </Link>
            <Link
              href="/"
              className="inline-flex items-center gap-2 text-stone-600 hover:text-stone-900 transition font-medium text-sm"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              <span className="hidden sm:inline">Back to Home</span>
              <span className="sm:hidden">Back</span>
            </Link>
          </div>
        </div>
      </header>

      {/* Profile Content */}
      <div className="flex-1 px-4 py-8 sm:px-6 sm:py-12">
        <div className="max-w-3xl mx-auto">
          {/* Profile Card */}
          <div className="bg-white rounded-2xl shadow-xl border border-stone-200 overflow-hidden">
            {/* Header */}
            <div className="bg-gradient-to-br from-stone-900 to-stone-800 px-6 py-8 sm:px-8 sm:py-10 relative overflow-hidden">
              <div className="absolute inset-0 bg-[url('data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNjAiIGhlaWdodD0iNjAiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+PGRlZnM+PHBhdHRlcm4gaWQ9ImdyaWQiIHdpZHRoPSI2MCIgaGVpZ2h0PSI2MCIgcGF0dGVyblVuaXRzPSJ1c2VyU3BhY2VPblVzZSI+PHBhdGggZD0iTSA2MCAwIEwgMCAwIDAgNjAiIGZpbGw9Im5vbmUiIHN0cm9rZT0icmdiYSgyNTUsMjU1LDI1NSwwLjAzKSIgc3Ryb2tlLXdpZHRoPSIxIi8+PC9wYXR0ZXJuPjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2dyaWQpIi8+PC9zdmc+')] opacity-50"></div>
              <div className="relative flex items-center justify-between">
                <div>
                  <h2 className="text-2xl sm:text-3xl font-bold text-white mb-2">
                    My Profile
                  </h2>
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      {user?.userType}
                    </span>
                    {!profile.emailVerified && (
                      <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-semibold bg-red-500/20 text-red-300 border border-red-500/30">
                        Email Not Verified
                      </span>
                    )}
                  </div>
                </div>
                {!editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="bg-amber-500 hover:bg-amber-600 text-white px-4 py-2 rounded-lg font-medium transition text-sm flex items-center gap-2 cursor-pointer"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
                      />
                    </svg>
                    <span className="hidden sm:inline">Edit Profile</span>
                  </button>
                )}
              </div>
            </div>

            {/* Messages */}
            {error && (
              <div className="mx-6 mt-6 sm:mx-8 p-4 bg-red-50 border border-red-200 text-red-700 rounded-xl flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm">{error}</span>
              </div>
            )}

            {success && (
              <div className="mx-6 mt-6 sm:mx-8 p-4 bg-green-50 border border-green-200 text-green-700 rounded-xl flex items-start gap-3">
                <svg
                  className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M5 13l4 4L19 7"
                  />
                </svg>
                <span className="text-sm">{success}</span>
              </div>
            )}

            {/* Form - Add key prop to force remount */}
            <form
              onSubmit={handleSubmit}
              className="px-6 py-6 sm:px-8 sm:py-8"
              key={editing ? 'editing' : 'viewing'}
            >
              <div className="space-y-6">
                {/* Email */}
                <div key="email-field">
                  <label className="block text-sm font-semibold text-stone-900 mb-2">
                    Email Address
                  </label>
                  {editing ? (
                    <input
                      key="email-input"
                      type="email"
                      name="email"
                      value={formData.email || ''}
                      onChange={handleInputChange}
                      className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition text-stone-900 bg-white"
                    />
                  ) : (
                    <p
                      key="email-display"
                      className="text-stone-700 px-4 py-3 bg-stone-50 rounded-xl"
                    >
                      {profile.email}
                    </p>
                  )}
                  {!profile.emailVerified && (
                    <p className="mt-2 text-xs text-red-600 flex items-center gap-1">
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                        />
                      </svg>
                      Please verify your email address
                    </p>
                  )}
                </div>

                {/* Organizer Fields */}
                {isOrganizer && (
                  <>
                    <div key="org-name-field">
                      <label className="block text-sm font-semibold text-stone-900 mb-2">
                        Organization Name
                      </label>
                      {editing ? (
                        <input
                          key="org-name-input"
                          type="text"
                          name="organizationName"
                          value={formData.organizationName || ''}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition text-stone-900 bg-white"
                        />
                      ) : (
                        <p
                          key="org-name-display"
                          className="text-stone-700 px-4 py-3 bg-stone-50 rounded-xl"
                        >
                          {profile.organizationName || 'Not set'}
                        </p>
                      )}
                    </div>

                    <div key="phone-field">
                      <label className="block text-sm font-semibold text-stone-900 mb-2">
                        Phone Number
                      </label>
                      {editing ? (
                        <input
                          key="phone-input"
                          type="tel"
                          name="phone"
                          value={formData.phone || ''}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition text-stone-900 bg-white"
                        />
                      ) : (
                        <p
                          key="phone-display"
                          className="text-stone-700 px-4 py-3 bg-stone-50 rounded-xl"
                        >
                          {profile.phone || 'Not set'}
                        </p>
                      )}
                    </div>

                    <div key="address-field">
                      <label className="block text-sm font-semibold text-stone-900 mb-2">
                        Address
                      </label>
                      {editing ? (
                        <input
                          key="address-input"
                          type="text"
                          name="address"
                          value={formData.address || ''}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition text-stone-900 bg-white"
                        />
                      ) : (
                        <p
                          key="address-display"
                          className="text-stone-700 px-4 py-3 bg-stone-50 rounded-xl"
                        >
                          {profile.address || 'Not set'}
                        </p>
                      )}
                    </div>

                    <div key="website-field">
                      <label className="block text-sm font-semibold text-stone-900 mb-2">
                        Website
                      </label>
                      {editing ? (
                        <input
                          key="website-input"
                          type="url"
                          name="website"
                          value={formData.website || ''}
                          onChange={handleInputChange}
                          className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition text-stone-900 bg-white"
                          placeholder="https://"
                        />
                      ) : (
                        <p
                          key="website-display"
                          className="text-stone-700 px-4 py-3 bg-stone-50 rounded-xl"
                        >
                          {profile.website || 'Not set'}
                        </p>
                      )}
                    </div>

                    <div key="description-field">
                      <label className="block text-sm font-semibold text-stone-900 mb-2">
                        Description
                      </label>
                      {editing ? (
                        <textarea
                          key="description-input"
                          name="description"
                          value={formData.description || ''}
                          onChange={handleInputChange}
                          rows={4}
                          className="w-full px-4 py-3 border border-stone-300 rounded-xl focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent transition resize-none text-stone-900 bg-white"
                        />
                      ) : (
                        <p
                          key="description-display"
                          className="text-stone-700 px-4 py-3 bg-stone-50 rounded-xl whitespace-pre-wrap"
                        >
                          {profile.description || 'Not set'}
                        </p>
                      )}
                    </div>
                  </>
                )}

                {/* Admin Info (Read-only) */}
                {isAdmin && (
                  <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                    <h3 className="text-sm font-semibold text-stone-900 mb-3">
                      Admin Information
                    </h3>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-stone-600">Admin Level:</span>
                        <span className="font-medium text-stone-900">
                          {profile.adminLevel || 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-stone-600">Department:</span>
                        <span className="font-medium text-stone-900">
                          {profile.department || 'N/A'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-stone-600">Employee ID:</span>
                        <span className="font-medium text-stone-900">
                          {profile.employeeId || 'N/A'}
                        </span>
                      </div>
                    </div>
                    <p className="mt-3 text-xs text-stone-500">
                      Admin-specific fields cannot be modified from this page.
                    </p>
                  </div>
                )}

                {/* Password Change Note */}
                <div className="bg-stone-50 border border-stone-200 rounded-xl p-4">
                  <p className="text-sm text-stone-600">
                    To change your password, please use the{' '}
                    <Link
                      href="/auth/forgot-password"
                      className="text-amber-600 hover:text-amber-700 font-semibold"
                    >
                      password reset flow
                    </Link>
                    .
                  </p>
                </div>
              </div>

              {/* Actions */}
              {editing && (
                <div className="mt-8 flex flex-col sm:flex-row gap-3">
                  <button
                    type="submit"
                    disabled={isSaving}
                    className="flex-1 bg-gradient-to-r from-amber-500 to-amber-600 text-white px-6 py-3 rounded-xl font-semibold hover:from-amber-600 hover:to-amber-700 transition shadow-lg shadow-amber-500/25 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {isSaving ? (
                      <>
                        <svg
                          className="animate-spin h-5 w-5"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                            fill="none"
                          />
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          />
                        </svg>
                        <span>Saving...</span>
                      </>
                    ) : (
                      'Save Changes'
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setEditing(false);
                      setError('');
                      setSuccess('');
                      // Reset form data
                      setFormData({
                        email: profile.email,
                        organizationName: profile.organizationName,
                        phone: profile.phone,
                        address: profile.address,
                        website: profile.website,
                        description: profile.description,
                      });
                    }}
                    className="flex-1 cursor-pointer bg-stone-200 text-stone-700 px-6 py-3 rounded-xl font-semibold hover:bg-stone-300 transition"
                  >
                    Cancel
                  </button>
                </div>
              )}
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
