import React from 'react';
import ReactDOM from 'react-dom/client';
// First: every other stylesheet resolves its colours through these tokens.
// (Custom properties resolve at computed-value time, so the order is not
//  strictly required — but reading the cascade top-down should show where
//  colour begins.)
import './theme.css';
import './index.css';
import './claymorphism.css';
// Must stay the last CSS import — see the header comment in tailwind.css.
import './tailwind.css';
import App from './App';
import { AuthProvider } from './contexts/AuthContext';
import { NavigationProvider } from './contexts/NavigationContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { ToastProvider } from './contexts/ToastContext';
import { ErrorBoundary } from './components/ErrorBoundary';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

const root = ReactDOM.createRoot(rootElement);
root.render(
  <React.StrictMode>
    <ErrorBoundary>
      {/* Outside AuthProvider on purpose: the theme is a property of the
          device, not of whoever is signed in, and it must survive sign-out
          and apply to the login screen too. */}
      <ThemeProvider>
        {/* Also outside AuthProvider: a sign-in failure needs somewhere to be
            reported, and that is before any of this is mounted. */}
        <ToastProvider>
          <AuthProvider>
            <NavigationProvider>
              <App />
            </NavigationProvider>
          </AuthProvider>
        </ToastProvider>
      </ThemeProvider>
    </ErrorBoundary>
  </React.StrictMode>
);