import React, { useState } from 'react';
import { motion } from 'motion/react';
import { ArrowRight, Camera, Check, Copy, Eye, EyeOff, KeyRound, Lock, Mail, MessageSquare, PhoneCall, ShieldCheck, Sparkles, UserCheck, Users } from 'lucide-react';
import { signInWithGooglePopup } from '../lib/firebaseAuth';
import { isSupabaseConfigured, supabase } from '../lib/supabaseClient';
import { apiFetch, setStoredToken } from '../services/api';
import type { UserProfile } from '../types/rikzen';
import { AvatarCropperModal } from './AvatarCropperModal';
import { SpiderEmblem } from './SpiderEmblem';

interface AuthFlowProps {
  initialProfile: UserProfile | null;
  onAuthenticated: (profile: UserProfile) => void;
}

type AuthStep = 'auth' | 'forgot' | 'onboarding' | 'congrats';

export const AuthFlow: React.FC<AuthFlowProps> = ({ initialProfile, onAuthenticated }) => {
  const [step, setStep] = useState<AuthStep>(
    initialProfile && !initialProfile.onboardingCompleted ? 'onboarding' : 'auth'
  );
  const [mode, setMode] = useState<'login' | 'register'>('register');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);
  const [googleLoading, setGoogleLoading] = useState(false);

  // Forgot / Reset password
  const [resetEmail, setResetEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [issuedCodePreview, setIssuedCodePreview] = useState<string | null>(null);
  const [newPassword, setNewPassword] = useState('');

  // Onboarding Profile
  const [draftProfile, setDraftProfile] = useState<UserProfile | null>(initialProfile);
  const [fullName, setFullName] = useState(initialProfile?.fullName || '');
  const [phone, setPhone] = useState(initialProfile?.phone || '');
  const [bio, setBio] = useState(initialProfile?.bio || 'Hey there! I am using RIKZEN CHAT.');
  const [dateOfBirth, setDateOfBirth] = useState(initialProfile?.dateOfBirth || '');
  const [avatarUrl, setAvatarUrl] = useState<string | null>(initialProfile?.avatarUrl || null);
  const [cropperOpen, setCropperOpen] = useState(false);
  const [copiedId, setCopiedId] = useState(false);

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const endpoint = mode === 'register' ? '/api/auth/register' : '/api/auth/login';
      const data = await apiFetch<{ token: string; profile: UserProfile }>(endpoint, {
        method: 'POST',
        body: JSON.stringify({ email, password, fullName: email.split('@')[0] }),
      });
      setStoredToken(data.token);
      setDraftProfile(data.profile);
      if (data.profile.onboardingCompleted) {
        onAuthenticated(data.profile);
      } else {
        setFullName(data.profile.fullName || '');
        setBio(data.profile.bio || 'Hey there! I am using RIKZEN CHAT.');
        setStep('onboarding');
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed.');
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleContinue = async () => {
    setError(null);
    setGoogleLoading(true);
    try {
      if (isSupabaseConfigured && supabase) {
        const { error: oauthErr } = await supabase.auth.signInWithOAuth({
          provider: 'google',
          options: {
            redirectTo: window.location.origin,
            queryParams: { prompt: 'select_account' },
          },
        });
        if (oauthErr) setError(oauthErr.message);
        return;
      }

      const { accessToken } = await signInWithGooglePopup();
      const data = await apiFetch<{ token: string; profile: UserProfile }>('/api/auth/google', {
        method: 'POST',
        body: JSON.stringify({ accessToken }),
      });
      setStoredToken(data.token);
      setDraftProfile(data.profile);
      if (data.profile.onboardingCompleted) {
        onAuthenticated(data.profile);
      } else {
        setFullName(data.profile.fullName || '');
        setAvatarUrl(data.profile.avatarUrl || null);
        setBio(data.profile.bio || 'Hey there! I am using RIKZEN CHAT.');
        setStep('onboarding');
      }
    } catch (err: any) {
      if (err?.code === 'auth/popup-closed-by-user') {
        setError('Google sign-in popup was closed before finishing.');
      } else if (err?.code === 'auth/popup-blocked') {
        setError('Please allow popups in your browser to sign in with Google.');
      } else {
        setError(err?.message || 'Google sign-in failed. Please try again.');
      }
    } finally {
      setGoogleLoading(false);
    }
  };

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await apiFetch('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email: resetEmail }),
      });
      setIssuedCodePreview(res.resetCode || null);
      setInfoMsg(res.message);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleCompleteReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await apiFetch('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ resetCode, newPassword }),
      });
      setInfoMsg('Password reset successfully. You can now log in.');
      setMode('login');
      setStep('auth');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveOnboarding = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fullName.trim()) {
      setError('Please enter your full name.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const data = await apiFetch<{ profile: UserProfile }>('/api/auth/complete-onboarding', {
        method: 'POST',
        body: JSON.stringify({
          fullName: fullName.trim(),
          phone: phone.trim() || null,
          bio: bio.trim(),
          dateOfBirth: dateOfBirth || null,
          avatarUrl,
        }),
      });
      setDraftProfile(data.profile);
      setStep('congrats');
    } catch (err: any) {
      setError(err.message || 'Could not save your profile.');
    } finally {
      setLoading(false);
    }
  };

  const copyId = async (id: string) => {
    try {
      await navigator.clipboard.writeText(id);
      setCopiedId(true);
      setTimeout(() => setCopiedId(false), 2000);
    } catch {
      // ignore
    }
  };

  return (
    <div className="min-h-screen bg-[#09090B] text-[#F5F5F7] flex flex-col">
      <div className="flex flex-1 flex-col lg:flex-row">
      {/* Left Brand Showcase on Desktop */}
      <div className="hidden lg:flex lg:w-1/2 flex-col justify-between border-r border-[#D4AF37]/15 bg-[#0C0C0F] p-12 relative overflow-hidden">
        <div
          className="pointer-events-none absolute -top-24 -left-24 h-96 w-96 rounded-full"
          style={{ background: 'radial-gradient(circle, rgba(212,175,55,0.12), transparent 70%)' }}
        />
        <div className="flex items-center gap-3.5 relative z-10">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#D4AF37]/30 bg-[#111115]">
            <SpiderEmblem size={28} />
          </div>
          <div>
            <p className="font-display text-lg font-bold tracking-[0.16em] text-[#F5E6B3]">RIKZEN CHAT</p>
            <p className="text-[11px] tracking-[0.22em] text-[#D4AF37]/80">CONNECT • CHAT • SHARE</p>
          </div>
        </div>

        <div className="relative z-10 max-w-lg">
          <h2 className="font-display text-4xl font-bold leading-tight text-white">
            Private, instant conversations engineered with craft.
          </h2>
          <p className="mt-4 text-base leading-relaxed text-[#9898A6]">
            Connect across devices using your permanent RIKZEN User ID, share encrypted-grade media, host communities, and place crystal-clear voice or video calls.
          </p>

          <div className="mt-10 grid grid-cols-3 gap-6 border-t border-white/10 pt-8">
            <div>
              <p className="font-display text-xl font-semibold text-[#D4AF37]">Unique ID</p>
              <p className="mt-1 text-xs text-[#9898A6]">Permanent cross-device discovery</p>
            </div>
            <div>
              <p className="font-display text-xl font-semibold text-[#22C55E]">Real-Time</p>
              <p className="mt-1 text-xs text-[#9898A6]">Instant delivery & read receipts</p>
            </div>
            <div>
              <p className="font-display text-xl font-semibold text-[#F5E6B3]">WebRTC</p>
              <p className="mt-1 text-xs text-[#9898A6]">Direct voice & video calling</p>
            </div>
          </div>
        </div>

        <p className="relative z-10 text-xs text-[#9898A6]">
          RIKZEN Platform · Privacy-First Architecture
        </p>
      </div>

      {/* Right Auth / Onboarding / Congratulations Panel */}
      <div className="flex flex-1 items-center justify-center p-5 sm:p-10">
        <div className="w-full max-w-md">
          {/* Mobile compact brand mark */}
          <div className="mb-8 flex items-center justify-center gap-3 lg:hidden">
            <SpiderEmblem size={32} />
            <span className="font-display text-xl font-bold tracking-[0.16em] text-[#F5E6B3]">RIKZEN CHAT</span>
          </div>

          {step === 'auth' && (
            <div className="rounded-2xl border border-[#D4AF37]/20 bg-[#111115] p-6 sm:p-8 shadow-xl">
              <div className="flex gap-1 rounded-xl bg-[#09090B] p-1 border border-white/5">
                <button
                  type="button"
                  onClick={() => {
                    setMode('register');
                    setError(null);
                  }}
                  className={`flex-1 min-h-[42px] rounded-lg text-sm font-medium transition ${
                    mode === 'register'
                      ? 'bg-[#D4AF37] text-[#09090B] font-semibold'
                      : 'text-[#9898A6] hover:text-white'
                  }`}
                >
                  Create Account
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMode('login');
                    setError(null);
                  }}
                  className={`flex-1 min-h-[42px] rounded-lg text-sm font-medium transition ${
                    mode === 'login'
                      ? 'bg-[#D4AF37] text-[#09090B] font-semibold'
                      : 'text-[#9898A6] hover:text-white'
                  }`}
                >
                  Sign In
                </button>
              </div>

              <h1 className="mt-6 font-display text-2xl font-bold text-white">
                {mode === 'register' ? 'Join RIKZEN CHAT' : 'Welcome back'}
              </h1>
              <p className="mt-1 text-sm text-[#9898A6]">
                {mode === 'register'
                  ? 'Create your account to receive your permanent RIKZEN ID.'
                  : 'Sign in with your email and password to continue.'}
              </p>

              {error && (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                  {error}
                </div>
              )}
              {infoMsg && (
                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
                  {infoMsg}
                </div>
              )}

              <button
                type="button"
                disabled={googleLoading || loading}
                onClick={handleGoogleContinue}
                className="mt-5 flex min-h-[46px] w-full items-center justify-center gap-3 rounded-xl border border-white/15 bg-white text-[#1F1F1F] px-4 text-sm font-semibold shadow-sm transition hover:bg-[#F5F5F7] disabled:opacity-60"
              >
                <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                  <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                  <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                  <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                  <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
                </svg>
                <span>{googleLoading ? 'Signing in with Google...' : 'Sign in with Google'}</span>
              </button>

              <div className="my-5 flex items-center gap-3">
                <div className="h-px flex-1 bg-white/10" />
                <span className="text-xs text-[#9898A6]">or continue with email</span>
                <div className="h-px flex-1 bg-white/10" />
              </div>

              <form onSubmit={handleEmailAuth} className="space-y-4">
                <div>
                  <label className="block text-xs font-medium text-[#9898A6] mb-1.5">Email Address</label>
                  <div className="relative">
                    <Mail size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9898A6]" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="you@example.com"
                      className="h-12 w-full rounded-xl border border-white/10 bg-[#09090B] pl-10 pr-4 text-sm text-white placeholder-[#9898A6]/60 focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#9898A6] mb-1.5">Password</label>
                  <div className="relative">
                    <KeyRound size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-[#9898A6]" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Minimum 6 characters"
                      className="h-12 w-full rounded-xl border border-white/10 bg-[#09090B] pl-10 pr-11 text-sm text-white placeholder-[#9898A6]/60 focus:border-[#D4AF37] focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 flex h-9 w-9 items-center justify-center text-[#9898A6] hover:text-white"
                      aria-label={showPassword ? 'Hide password' : 'Show password'}
                    >
                      {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                    </button>
                  </div>
                </div>

                {mode === 'login' && (
                  <div className="flex justify-end">
                    <button
                      type="button"
                      onClick={() => {
                        setResetEmail(email);
                        setError(null);
                        setInfoMsg(null);
                        setStep('forgot');
                      }}
                      className="text-xs font-medium text-[#D4AF37] hover:underline"
                    >
                      Forgot password?
                    </button>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-5 text-sm font-semibold text-[#09090B] transition hover:bg-[#E5C76B] disabled:opacity-50"
                >
                  <span>{loading ? 'Please wait...' : mode === 'register' ? 'Continue with Email' : 'Sign In'}</span>
                  <ArrowRight size={16} />
                </button>
              </form>
            </div>
          )}

          {step === 'forgot' && (
            <div className="rounded-2xl border border-[#D4AF37]/20 bg-[#111115] p-6 sm:p-8 shadow-xl">
              <h2 className="font-display text-2xl font-bold">Reset Password</h2>
              <p className="mt-1 text-sm text-[#9898A6]">Request a reset code and set a new password.</p>

              {error && (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                  {error}
                </div>
              )}
              {infoMsg && (
                <div className="mt-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-xs text-emerald-300">
                  {infoMsg}
                  {issuedCodePreview && (
                    <p className="mt-1.5 font-mono-id font-semibold text-white">
                      Reset Code: {issuedCodePreview}
                    </p>
                  )}
                </div>
              )}

              <form onSubmit={handleRequestReset} className="mt-5 space-y-3">
                <input
                  type="email"
                  required
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder="Account email"
                  className="h-12 w-full rounded-xl border border-white/10 bg-[#09090B] px-4 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="min-h-[44px] w-full rounded-xl border border-[#D4AF37]/40 bg-[#D4AF37]/15 text-sm font-medium text-[#F5E6B3] hover:bg-[#D4AF37]/25"
                >
                  Generate Reset Code
                </button>
              </form>

              <form onSubmit={handleCompleteReset} className="mt-6 space-y-3 border-t border-white/10 pt-5">
                <input
                  type="text"
                  required
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  placeholder="Enter reset code"
                  className="h-12 w-full rounded-xl border border-white/10 bg-[#09090B] px-4 text-sm font-mono-id uppercase text-white focus:border-[#D4AF37] focus:outline-none"
                />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  placeholder="New password (min 6 characters)"
                  className="h-12 w-full rounded-xl border border-white/10 bg-[#09090B] px-4 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={loading}
                  className="min-h-[46px] w-full rounded-xl bg-[#D4AF37] text-sm font-semibold text-[#09090B] hover:bg-[#E5C76B]"
                >
                  Update Password
                </button>
              </form>

              <button
                type="button"
                onClick={() => setStep('auth')}
                className="mt-4 w-full text-center text-xs text-[#9898A6] hover:text-white"
              >
                Back to Sign In
              </button>
            </div>
          )}

          {step === 'onboarding' && draftProfile && (
            <div className="rounded-2xl border border-[#D4AF37]/20 bg-[#111115] p-6 sm:p-8 shadow-xl">
              <h2 className="font-display text-2xl font-bold">Complete Your Profile</h2>
              <p className="mt-1 text-sm text-[#9898A6]">
                Your permanent RIKZEN User ID has been assigned.
              </p>

              {/* Permanent RIKZEN ID Banner */}
              <div className="mt-4 flex items-center justify-between rounded-xl border border-[#D4AF37]/30 bg-[#09090B] px-4 py-3">
                <div>
                  <p className="text-[11px] text-[#9898A6]">Permanent RIKZEN ID</p>
                  <p className="font-mono-id text-base font-semibold text-[#F5E6B3]">
                    {draftProfile.rikzenId}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => copyId(draftProfile.rikzenId)}
                  className="flex min-h-[40px] items-center gap-1.5 rounded-lg border border-white/10 px-3 text-xs text-[#D4AF37] hover:bg-white/5"
                >
                  {copiedId ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedId ? 'Copied' : 'Copy'}</span>
                </button>
              </div>

              {error && (
                <div className="mt-4 rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-xs text-red-300">
                  {error}
                </div>
              )}

              <form onSubmit={handleSaveOnboarding} className="mt-5 space-y-4">
                <div className="flex flex-col items-center">
                  <button
                    type="button"
                    onClick={() => setCropperOpen(true)}
                    className="group relative flex h-24 w-24 items-center justify-center overflow-hidden rounded-full border-2 border-dashed border-[#D4AF37]/60 bg-[#09090B] transition hover:border-[#D4AF37]"
                  >
                    {avatarUrl ? (
                      <img
                        src={avatarUrl}
                        alt="Profile preview"
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <Camera size={24} className="text-[#D4AF37]" />
                    )}
                    <span className="absolute inset-0 flex items-center justify-center bg-black/50 text-[11px] font-medium opacity-0 transition group-hover:opacity-100">
                      Edit Photo
                    </span>
                  </button>
                  <span className="mt-1.5 text-xs text-[#9898A6]">Upload or capture profile photo</span>
                  {avatarUrl && (
                    <button
                      type="button"
                      onClick={() => setAvatarUrl(null)}
                      className="mt-1 text-xs text-red-400 hover:underline cursor-pointer"
                    >
                      Remove Photo
                    </button>
                  )}
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#9898A6] mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Your full name"
                    className="h-11 w-full rounded-xl border border-white/10 bg-[#09090B] px-3.5 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-[#9898A6] mb-1">Email (Verified)</label>
                    <input
                      type="text"
                      readOnly
                      value={draftProfile.email}
                      className="h-11 w-full rounded-xl border border-white/5 bg-[#09090B]/60 px-3.5 text-xs text-[#9898A6]"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#9898A6] mb-1">Phone (Optional)</label>
                    <input
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder="+1 555 0192"
                      className="h-11 w-full rounded-xl border border-white/10 bg-[#09090B] px-3.5 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#9898A6] mb-1">Bio</label>
                  <textarea
                    rows={2}
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    className="w-full rounded-xl border border-white/10 bg-[#09090B] p-3 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#9898A6] mb-1">Date of Birth (Optional)</label>
                  <input
                    type="date"
                    value={dateOfBirth}
                    onChange={(e) => setDateOfBirth(e.target.value)}
                    className="h-11 w-full rounded-xl border border-white/10 bg-[#09090B] px-3.5 text-sm text-white focus:border-[#D4AF37] focus:outline-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-5 text-sm font-semibold text-[#09090B] transition hover:bg-[#E5C76B]"
                >
                  <UserCheck size={16} />
                  <span>{loading ? 'Creating Profile...' : 'Save & Create Account'}</span>
                </button>
              </form>
            </div>
          )}

          {step === 'congrats' && draftProfile && (
            <motion.div
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              className="rounded-2xl border border-[#D4AF37]/35 bg-[#111115] p-8 text-center shadow-[0_0_60px_rgba(212,175,55,0.14)]"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-[#22C55E]/15 text-[#22C55E]">
                <Sparkles size={22} />
              </div>

              <h2 className="mt-4 font-display text-2xl font-bold tracking-wide text-[#F5E6B3]">
                CONGRATULATIONS!
              </h2>
              <p className="mt-2 text-sm text-white/90">
                Your RIKZEN CHAT account has been successfully created.
              </p>
              <p className="mt-1 text-sm font-medium text-[#D4AF37]">
                Welcome to the RIKZEN family!
              </p>

              <div className="my-6 flex flex-col items-center rounded-2xl border border-white/10 bg-[#09090B] p-5">
                <div className="h-20 w-20 overflow-hidden rounded-full border-2 border-[#D4AF37]">
                  {draftProfile.avatarUrl ? (
                    <img
                      src={draftProfile.avatarUrl}
                      alt={draftProfile.fullName}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-[#18181D] font-display text-2xl font-bold text-[#D4AF37]">
                      {draftProfile.fullName.charAt(0).toUpperCase()}
                    </div>
                  )}
                </div>
                <p className="mt-3 font-display text-lg font-semibold text-white">{draftProfile.fullName}</p>
                <div className="mt-1.5 flex items-center gap-2 text-xs text-[#D4AF37]">
                  <ShieldCheck size={14} />
                  <span className="font-mono-id font-semibold">{draftProfile.rikzenId}</span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => onAuthenticated(draftProfile)}
                className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-xl bg-[#D4AF37] px-5 text-sm font-semibold text-[#09090B] transition hover:bg-[#E5C76B]"
              >
                <span>Continue to RIKZEN CHAT</span>
                <ArrowRight size={16} />
              </button>
            </motion.div>
          )}
        </div>
      </div>
      </div>

      {/* Dedicated Separate Bottom Section */}
      <footer className="border-t border-[#D4AF37]/15 bg-[#0B0B0E] px-5 py-8 sm:px-10">
        <div className="mx-auto max-w-6xl">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-xl border border-white/8 bg-[#111115] p-4">
              <div className="flex items-center gap-2.5 text-[#D4AF37]">
                <ShieldCheck size={18} />
                <h3 className="font-display text-sm font-semibold text-white">Permanent RIKZEN ID</h3>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[#9898A6]">
                Find and connect with friends securely using your unique RIKZEN ID without exposing private emails.
              </p>
            </div>

            <div className="rounded-xl border border-white/8 bg-[#111115] p-4">
              <div className="flex items-center gap-2.5 text-[#22C55E]">
                <MessageSquare size={18} />
                <h3 className="font-display text-sm font-semibold text-white">Real-Time Messaging</h3>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[#9898A6]">
                Instant personal & group chats with live typing, delivery ticks, replies, voice notes, and media sharing.
              </p>
            </div>

            <div className="rounded-xl border border-white/8 bg-[#111115] p-4">
              <div className="flex items-center gap-2.5 text-[#F5E6B3]">
                <Users size={18} />
                <h3 className="font-display text-sm font-semibold text-white">Updates & Communities</h3>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[#9898A6]">
                Share 24-hour status updates, follow verified channels, and organize announcement communities.
              </p>
            </div>

            <div className="rounded-xl border border-white/8 bg-[#111115] p-4">
              <div className="flex items-center gap-2.5 text-[#D4AF37]">
                <PhoneCall size={18} />
                <h3 className="font-display text-sm font-semibold text-white">Voice & Video Calls</h3>
              </div>
              <p className="mt-1.5 text-xs leading-relaxed text-[#9898A6]">
                Direct 1-to-1 WebRTC voice and HD video calls with call history and privacy controls built in.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-col items-center justify-between gap-3 border-t border-white/8 pt-5 text-xs text-[#9898A6] sm:flex-row">
            <div className="flex items-center gap-2">
              <SpiderEmblem size={18} />
              <span className="font-display font-semibold tracking-[0.14em] text-[#F5E6B3]">RIKZEN CHAT</span>
              <span>·</span>
              <span>CONNECT • CHAT • SHARE</span>
            </div>
            <div className="flex items-center gap-1.5">
              <Lock size={13} className="text-[#22C55E]" />
              <span>Privacy-First Architecture · Multi-Device Ready</span>
            </div>
          </div>
        </div>
      </footer>

      {cropperOpen && (
        <AvatarCropperModal
          currentAvatarUrl={avatarUrl}
          onSave={(url) => setAvatarUrl(url)}
          onClose={() => setCropperOpen(false)}
        />
      )}
    </div>
  );
};
