import React, { useState } from 'react'
import { signIn, signUp, resetPassword } from '../supabase'

export default function AuthScreen() {
  const [mode,     setMode]     = useState('login') // login | signup | forgot
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [name,     setName]     = useState('')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState('')
  const [message,  setMessage]  = useState('')

  const switchMode = (next) => { setError(''); setMessage(''); setMode(next) }

  // ── Login ──────────────────────────────────────────────────
  const handleLogin = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await signIn(email, password)
      // Success: App.jsx onAuthStateChange → SIGNED_IN → navigates away.
      // Keep loading=true so the button stays disabled until unmount.
    } catch (err) {
      setError(err.message || 'Login failed — please try again')
      setLoading(false) // only reset on failure
    }
  }

  // ── Sign up ────────────────────────────────────────────────
  const handleSignUp = async (e) => {
    e.preventDefault()
    setError('')
    if (!name.trim())        { setError('Please enter your name.'); return }
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return }
    setLoading(true)
    try {
      await signUp(email, password, name.trim())
      setMessage('Check your email for a confirmation link, then log in.')
      setMode('login')
    } catch (err) {
      setError(err.message || 'Sign up failed — please try again')
    } finally {
      setLoading(false)
    }
  }

  // ── Forgot password ────────────────────────────────────────
  const handleForgot = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await resetPassword(email)
      setMessage('Reset link sent — check your inbox.')
      setMode('login')
    } catch (err) {
      setError(err.message || 'Could not send reset link — try again')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="auth-screen">
      <div className="auth-card">

        <div className="auth-logo">💪</div>
        <h1 className="auth-app-name">Workout Tracker</h1>

        {/* Tabs */}
        {mode !== 'forgot' && (
          <div className="auth-tabs">
            <button
              className={`auth-tab ${mode === 'login'  ? 'auth-tab--active' : ''}`}
              onClick={() => switchMode('login')}
            >Log In</button>
            <button
              className={`auth-tab ${mode === 'signup' ? 'auth-tab--active' : ''}`}
              onClick={() => switchMode('signup')}
            >Sign Up</button>
          </div>
        )}

        {/* Forgot-password heading */}
        {mode === 'forgot' && (
          <div className="auth-section-title">
            <button className="auth-back-link" onClick={() => switchMode('login')}>← Back</button>
            <h2>Reset Password</h2>
            <p className="auth-hint">Enter your email and we'll send a reset link.</p>
          </div>
        )}

        {message && <div className="auth-message">{message}</div>}
        {error   && <div className="auth-error">{error}</div>}

        {/* ── Login form ── */}
        {mode === 'login' && (
          <form className="auth-form" onSubmit={handleLogin}>
            <label className="field-label">Email</label>
            <input
              className="field-input" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" required
            />
            <label className="field-label">Password</label>
            <input
              className="field-input" type="password" placeholder="••••••••"
              value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="current-password" required
            />
            <button
              type="button" className="auth-forgot-link"
              onClick={() => switchMode('forgot')}
            >
              Forgot password?
            </button>
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? 'Logging in…' : 'Log In'}
            </button>
          </form>
        )}

        {/* ── Sign-up form ── */}
        {mode === 'signup' && (
          <form className="auth-form" onSubmit={handleSignUp}>
            <label className="field-label">Name</label>
            <input
              className="field-input" type="text" placeholder="Your name"
              value={name} onChange={e => setName(e.target.value)}
              autoComplete="name" required
            />
            <label className="field-label">Email</label>
            <input
              className="field-input" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" required
            />
            <label className="field-label">Password</label>
            <input
              className="field-input" type="password" placeholder="Min. 6 characters"
              value={password} onChange={e => setPassword(e.target.value)}
              autoComplete="new-password" required
            />
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? 'Creating account…' : 'Create Account'}
            </button>
          </form>
        )}

        {/* ── Forgot-password form ── */}
        {mode === 'forgot' && (
          <form className="auth-form" onSubmit={handleForgot}>
            <label className="field-label">Email</label>
            <input
              className="field-input" type="email" placeholder="you@example.com"
              value={email} onChange={e => setEmail(e.target.value)}
              autoComplete="email" required
            />
            <button className="auth-submit" type="submit" disabled={loading}>
              {loading ? 'Sending…' : 'Send Reset Link'}
            </button>
          </form>
        )}

      </div>
    </div>
  )
}
