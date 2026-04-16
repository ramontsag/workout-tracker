import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './App.css'

// StrictMode intentionally double-invokes every effect in development.
// That fires two concurrent getSession() / onAuthStateChange registrations
// which race for the GoTrue Navigator Lock → NavigatorLockAcquireTimeoutError.
// Removed permanently — the app does not depend on any behaviour StrictMode checks.
ReactDOM.createRoot(document.getElementById('root')).render(<App />)
