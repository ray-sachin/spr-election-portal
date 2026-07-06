import React, { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';

export const Login: React.FC = () => {
  const { requestOtp, verifyOtp, signInWithGoogle, clearError, error: authError } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [step, setStep] = useState<'email' | 'otp'>('email'); // 'email' or 'otp'
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleGoogleSignIn = async () => {
    setError(null);
    setInfo(null);
    setSubmitting(true);
    try {
      clearError(); // Reset any previous auth errors without logging out/unmounting
      const result = await signInWithGoogle();
      if (!result.success) {
        setError(result.error || 'Failed to initialize Google login.');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during Google Sign In.');
    } finally {
      setSubmitting(false);
    }
  };

  const validateEmail = (inputEmail: string): boolean => {
    const trimmed = inputEmail.trim().toLowerCase();
    
    // Check domain
    const parts = trimmed.split('@');
    if (parts.length !== 2 || parts[1] !== 'nituk.ac.in') {
      setError('Invalid domain. You must use your @nituk.ac.in university email.');
      return false;
    }

    // Check local part pattern
    const localPart = parts[0];
    if (!/^bt24cse\d+$/i.test(localPart)) {
      setError('Only BT24 CSE students are eligible for this election.');
      return false;
    }

    return true;
  };

  const handleRequestOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    clearError(); // Reset any previous auth errors without logging out/unmounting

    if (!email) {
      setError('Please enter your university email.');
      return;
    }

    if (!validateEmail(email)) {
      return;
    }

    setSubmitting(true);
    try {
      const result = await requestOtp(email);
      if (result.success) {
        setStep('otp');
        setInfo(result.message || 'OTP code sent. Please check your inbox.');
      } else {
        setError(result.error || 'Failed to send OTP.');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!otpCode) {
      setError('Please enter the 6-digit OTP code.');
      return;
    }

    if (!/^\d{6}$/.test(otpCode.trim())) {
      setError('OTP must be exactly 6 digits.');
      return;
    }

    setSubmitting(true);
    try {
      const result = await verifyOtp(email, otpCode.trim());
      if (result.success) {
        // Redirection is handled in App.tsx routing depending on student profiles
        navigate('/');
      } else {
        setError(result.error || 'Invalid OTP code. Please check and try again.');
      }
    } catch (err: any) {
      setError(err.message || 'An error occurred during verification.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
      <main style={{ width: '100%', margin: '0 auto', maxWidth: '420px' }}>
        
        <div style={{ textAlign: 'center', marginBottom: '2.5rem' }}>
          <h1 className="display-title" style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>
            Register of Voters
          </h1>
          <p className="muted-text" style={{ fontSize: '0.9rem' }}>
            BT24 CSE Student Placement Representative Election
          </p>
        </div>

        {(authError || error) && (
          <div className="notice-box error" role="alert">
            <div className="notice-title">Access Denied</div>
            <p style={{ fontSize: '0.9rem' }}>{authError || error}</p>
          </div>
        )}

        {info && (
          <div className="notice-box success" role="status">
            <div className="notice-title">Notice</div>
            <p style={{ fontSize: '0.9rem' }}>{info}</p>
          </div>
        )}

        <div style={{ border: '1px solid var(--ink)', padding: '2rem 1.5rem', backgroundColor: 'var(--paper)' }}>
          {step === 'email' ? (
            <>
              <form onSubmit={handleRequestOtp}>
                <div className="form-group">
                  <label htmlFor="email-input">Student Email Address</label>
                  <input
                    id="email-input"
                    className="input-field mono"
                    type="email"
                    placeholder="bt24cse001@nituk.ac.in"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    disabled={submitting}
                    autoComplete="email"
                    required
                  />
                  <span className="muted-text" style={{ fontSize: '0.75rem', marginTop: '0.4rem', display: 'block' }}>
                    Enter your official university email (starts with <span className="mono-data">bt24cse</span>).
                  </span>
                </div>

                <button
                  type="submit"
                  className="btn"
                  style={{ width: '100%', marginTop: '0.5rem' }}
                  disabled={submitting}
                >
                  {submitting ? 'Verifying roll...' : 'Request login code'}
                </button>
              </form>

              <div style={{ display: 'flex', alignItems: 'center', margin: '1.5rem 0' }}>
                <hr style={{ flexGrow: 1, border: 'none', borderTop: '1px solid var(--register)' }} />
                <span className="muted-text" style={{ padding: '0 0.75rem', fontSize: '0.8rem', textTransform: 'uppercase' }}>or</span>
                <hr style={{ flexGrow: 1, border: 'none', borderTop: '1px solid var(--register)' }} />
              </div>

              <button
                type="button"
                className="btn btn-secondary"
                style={{
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.5rem'
                }}
                disabled={submitting}
                onClick={handleGoogleSignIn}
              >
                <svg viewBox="0 0 24 24" width="18" height="18" style={{ fill: 'currentColor' }}>
                  <path d="M12.24 10.285V14.4h6.887c-.648 2.41-2.519 4.114-5.136 4.114A5.514 5.514 0 0 1 8.5 13c0-3.037 2.463-5.5 5.5-5.5 1.48 0 2.82.59 3.82 1.54l3.102-3.102C18.96 4.02 16.68 3 14 3a9 9 0 0 0-9 9 9 9 0 0 0 9 9c4.91 0 8.163-3.455 8.163-8.314 0-.58-.063-1.127-.183-1.4H12.24Z" />
                </svg>
                Sign in with Google
              </button>
            </>
          ) : (
            <form onSubmit={handleVerifyOtp}>
              <div className="form-group">
                <label htmlFor="otp-input">Verification Code (OTP)</label>
                <input
                  id="otp-input"
                  className="input-field mono"
                  type="text"
                  placeholder="123456"
                  maxLength={6}
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value)}
                  disabled={submitting}
                  autoFocus
                  required
                />
                <span className="muted-text" style={{ fontSize: '0.75rem', marginTop: '0.4rem', display: 'block' }}>
                  Enter the 6-digit code sent to <span className="mono-data">{email}</span>.
                </span>
              </div>

              <button
                type="submit"
                className="btn"
                style={{ width: '100%', marginTop: '0.5rem' }}
                disabled={submitting}
              >
                {submitting ? 'Verifying...' : 'Verify login code'}
              </button>

              <button
                type="button"
                className="btn btn-secondary"
                style={{ width: '100%', marginTop: '0.75rem' }}
                onClick={() => {
                  setStep('email');
                  setError(null);
                  setInfo(null);
                  setOtpCode('');
                }}
                disabled={submitting}
              >
                Change email address
              </button>
            </form>
          )}
        </div>

        <div style={{ textAlign: 'center', marginTop: '2rem' }}>
          <p className="muted-text" style={{ fontSize: '0.8rem' }}>
            Closed Electoral Portal. Access strictly restricted to eligible batch members.
          </p>
        </div>

      </main>
    </div>
  );
};
export default Login;
