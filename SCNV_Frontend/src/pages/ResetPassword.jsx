import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../config/supabase';
import Antigravity from '../components/Antigravity';
import '../styles/auth.css';
import '../styles/components.css';

const FEATURES = [
  { icon: '🎯', text: 'Orchestrator Agent – Coordination' },
  { icon: '🔍', text: 'SCM Analyst – Classification' },
  { icon: '⚡', text: 'Optimizer – Network Routes' },
];

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);

  useEffect(() => {
    // Supabase fires PASSWORD_RECOVERY when the user arrives via the reset email link
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setSessionReady(true);
      }
    });

    // Also check if there's already an active session (e.g. page reload after recovery)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) setSessionReady(true);
    });

    return () => subscription.unsubscribe();
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    if (password.length < 6) {
      setError('Password must be at least 6 characters.');
      return;
    }
    setError('');
    setLoading(true);
    try {
      const { error: updateError } = await supabase.auth.updateUser({ password });
      if (updateError) throw updateError;
      setSuccess(true);
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.message || 'Failed to reset password. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="auth-page">
      {/* ── Left branding panel ── */}
      <div className="auth-panel">
        <div className="auth-panel__canvas">
          <Antigravity
            count={400}
            magnetRadius={6}
            ringRadius={8}
            waveSpeed={0.3}
            waveAmplitude={1.2}
            particleSize={1.8}
            lerpSpeed={0.06}
            autoAnimate
            particleVariance={1.2}
            rotationSpeed={0.1}
            depthFactor={1.2}
            pulseSpeed={2.5}
            particleShape="capsule"
            fieldStrength={10}
          />
        </div>
        <div className="auth-panel__shape auth-panel__shape--tl" />
        <div className="auth-panel__shape auth-panel__shape--br" />

        <div className="auth-panel__content">
          <div className="auth-brand">
            <div className="auth-brand__logo">
              <span className="auth-brand__name">OFI</span>
              <span className="auth-brand__name">Services</span>
            </div>
            <div className="auth-brand__subtitle">Supply Chain Network Visibility</div>
          </div>

          <h1 className="auth-heading">
            OPTIMIZE YOUR<br />
            <span>SUPPLY CHAIN</span>
          </h1>

          <p className="auth-description">
            AI-powered multi-agent system for supply chain optimization, classification,
            and process analytics. Intelligent decision support at every level.
          </p>

          <ul className="auth-features">
            {FEATURES.map((f) => (
              <li key={f.text} className="auth-feature">
                <div className="auth-feature__icon">{f.icon}</div>
                <span className="auth-feature__text">{f.text}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* ── Right form panel ── */}
      <div className="auth-form-panel">
        <div className="auth-card">
          <h2 className="auth-card__title">Set new password</h2>
          <p className="auth-card__subtitle">
            Choose a strong password for your account.
          </p>

          {success ? (
            <div className="auth-success">
              <span className="auth-success__icon">✓</span>
              <div>
                <strong>Password updated</strong>
                <p>Your password has been reset successfully. Redirecting you to sign in...</p>
              </div>
            </div>
          ) : !sessionReady ? (
            <div className="alert-error">
              ⚠️ Invalid or expired reset link. Please request a new password reset from the{' '}
              <button
                type="button"
                className="auth-forgot-link"
                style={{ display: 'inline', padding: 0 }}
                onClick={() => navigate('/login')}
              >
                login page
              </button>.
            </div>
          ) : (
            <form className="auth-form" onSubmit={handleSubmit}>
              <div className="form-group">
                <label className="form-label">New Password</label>
                <div className="auth-pw-wrapper">
                  <input
                    type={showPass ? 'text' : 'password'}
                    required
                    className="form-input"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 6 characters"
                    style={{ paddingRight: '48px' }}
                  />
                  <button
                    type="button"
                    className="auth-pw-toggle"
                    onClick={() => setShowPass((p) => !p)}
                    aria-label={showPass ? 'Hide password' : 'Show password'}
                  >
                    {showPass ? '🙈' : '👁️'}
                  </button>
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Confirm New Password</label>
                <input
                  type={showPass ? 'text' : 'password'}
                  required
                  className="form-input"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="Repeat your new password"
                />
              </div>

              {error && <div className="alert-error">⚠️ {error}</div>}

              <button type="submit" className="auth-submit" disabled={loading}>
                {loading ? 'Updating...' : 'Update Password'}
              </button>
            </form>
          )}

          <p className="auth-footer">
            Secured AI-powered supply chain platform<br />
            © 2025 OFI Services SCNV. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
}

export default ResetPasswordPage;
