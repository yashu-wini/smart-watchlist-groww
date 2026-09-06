import React, { useState } from 'react';
import { loginApi, registerApi, type User } from '../api';

interface AuthScreenProps {
  onAuthSuccess: (user: User, token: string) => void;
}

export const AuthScreen: React.FC<AuthScreenProps> = ({ onAuthSuccess }) => {
  const [mode, setMode] = useState<'SIGN_IN' | 'CREATE_ACCOUNT'>('SIGN_IN');
  
  // Form states
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // UI states
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const switchMode = (newMode: 'SIGN_IN' | 'CREATE_ACCOUNT') => {
    setMode(newMode);
    setEmail('');
    setPassword('');
    setConfirmPassword('');
    setError(null);
    setSuccessMsg(null);
  };

  // 1. Handle Sign In
  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password) {
      setError('Please enter both email and password.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const { user, token } = await loginApi(email.trim(), password);
      onAuthSuccess(user, token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid email or password');
    } finally {
      setLoading(false);
    }
  };

  // 2. Handle Demo Login
  const handleDemoLogin = async () => {
    setLoading(true);
    setError(null);

    try {
      const { user, token } = await loginApi('dev@example.com', 'password123');
      onAuthSuccess(user, token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Demo login failed');
    } finally {
      setLoading(false);
    }
  };

  // 3. Handle Create Account
  const handleCreateAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanEmail = email.trim();

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!cleanEmail || !emailRegex.test(cleanEmail)) {
      setError('Please provide a valid email address.');
      return;
    }

    if (!password || password.length < 8) {
      setError('Password must be at least 8 characters long.');
      return;
    }

    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await registerApi(cleanEmail, password);
      // Auto-login after successful registration
      const { user, token } = await loginApi(cleanEmail, password);
      onAuthSuccess(user, token);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-container">
      <div className="auth-card" id="auth-card">
        {/* Brand Header */}
        <div className="auth-header">
          <div className="auth-logo-badge">
            <span className="logo-dot"></span>
          </div>
          <h1 className="auth-title">Market Watch</h1>
          <p className="auth-subtitle">Know what changed since you last checked.</p>
        </div>

        {/* Mode Tabs */}
        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            className={`auth-tab ${mode === 'SIGN_IN' ? 'active' : ''}`}
            onClick={() => switchMode('SIGN_IN')}
            id="tab-sign-in"
          >
            Sign In
          </button>
          <button
            type="button"
            className={`auth-tab ${mode === 'CREATE_ACCOUNT' ? 'active' : ''}`}
            onClick={() => switchMode('CREATE_ACCOUNT')}
            id="tab-create-account"
          >
            Create Account
          </button>
        </div>

        {/* Notifications / Error Banner */}
        {error && (
          <div className="auth-alert alert-error" id="auth-error-banner">
            <span className="alert-icon">⚠️</span>
            <span>{error}</span>
          </div>
        )}

        {successMsg && (
          <div className="auth-alert alert-success" id="auth-success-banner">
            <span className="alert-icon">✓</span>
            <span>{successMsg}</span>
          </div>
        )}

        {/* Form Body */}
        {mode === 'SIGN_IN' ? (
          <form onSubmit={handleSignIn} className="auth-form" id="sign-in-form">
            <div className="form-group">
              <label htmlFor="signin-email">Email</label>
              <input
                id="signin-email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="signin-password">Password</label>
              <input
                id="signin-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="btn-primary auth-submit-btn"
              disabled={loading}
              id="signin-btn"
            >
              {loading ? <span className="button-spinner"></span> : 'Sign In'}
            </button>

            <div className="auth-divider">
              <span>or</span>
            </div>

            <button
              type="button"
              className="btn-secondary demo-login-btn"
              onClick={handleDemoLogin}
              disabled={loading}
              id="demo-login-btn"
            >
              🚀 Demo Login (Instant Access)
            </button>
          </form>
        ) : (
          <form onSubmit={handleCreateAccount} className="auth-form" id="register-form">
            <div className="form-group">
              <label htmlFor="register-email">Email</label>
              <input
                id="register-email"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="register-password">Password (min. 8 characters)</label>
              <input
                id="register-password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </div>

            <div className="form-group">
              <label htmlFor="register-confirm-password">Confirm Password</label>
              <input
                id="register-confirm-password"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
                disabled={loading}
              />
            </div>

            <button
              type="submit"
              className="btn-primary auth-submit-btn"
              disabled={loading}
              id="create-account-btn"
            >
              {loading ? <span className="button-spinner"></span> : 'Create Account'}
            </button>
          </form>
        )}

        {/* Footer info */}
        <div className="auth-footer">
          <span>Protected by session JWT authentication</span>
        </div>
      </div>
    </div>
  );
};
