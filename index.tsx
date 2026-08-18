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
import { installGlobalErrorReporting } from './src/utils/errorReport';
import { watchInstallPrompt } from './src/utils/pwaInstall';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

// Installed BEFORE the first render, because an error thrown on the way up is
// exactly the kind that leaves a blank screen with no explanation. An
// ErrorBoundary cannot see these — they happen outside React's tree, or in
// promises nobody awaited.
installGlobalErrorReporting();

// Also before the first render, and for the same class of reason: Chrome
// fires `beforeinstallprompt` once, early, and often before React has
// mounted. A listener added on mount can miss it outright, and there is no
// way to ask for the event again.
watchInstallPrompt(window);

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