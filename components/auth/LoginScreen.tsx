
import React, { useState } from 'react';
import { LotusIcon } from '../../constants';
import { ChevronRight, Loader2, AlertCircle, Database, Mail, Lock, UserPlus } from 'lucide-react';
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword } from '@firebase/auth';
import { auth, googleProvider } from '../../firebase/config';
import { seedDatabase } from '../../firebase/seed';

interface LoginScreenProps {
  onLoginSuccess: (email: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed State
  const [isSeeding, setIsSeeding] = useState(false);
  const [seedMsg, setSeedMsg] = useState<string | null>(null);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError(null);
    try {
      await signInWithPopup(auth, googleProvider);
      // Auth listener in App.tsx handles redirect
    } catch (err: any) {
      console.error("Google Login Error:", err);
      setIsLoading(false);

      if (err.code === 'auth/unauthorized-domain') {
        setError("Domain Error: Add this domain to Firebase Console > Auth > Settings > Authorized Domains.");
      } else if (err.code === 'auth/popup-closed-by-user') {
        setError("Sign-in cancelled.");
      } else if (err.code === 'auth/popup-blocked') {
        setError("Popup blocked. Please allow popups for this site.");
      } else {
        setError("Google Sign-In failed. Please try again.");
      }
    }
  };

  const handleEmailAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);

    try {
      if (isRegistering) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      // Auth listener handles redirect
    } catch (err: any) {
      console.error(err);
      setIsLoading(false);
      if (err.code === 'auth/invalid-email') {
        setError("Invalid email address.");
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError("Invalid email or password.");
      } else if (err.code === 'auth/email-already-in-use') {
        setError("Email is already registered. Please login.");
      } else if (err.code === 'auth/weak-password') {
        setError("Password should be at least 6 characters.");
      } else if (err.code === 'auth/unauthorized-domain') {
        setError("Domain Error: Add this domain to Firebase Console > Auth > Settings > Authorized Domains.");
      } else {
        setError(err.message || "Authentication failed.");
      }
    }
  };

  const handleSeed = async () => {
    if (isSeeding) return;
    setIsSeeding(true);
    setSeedMsg("Seeding DB...");
    try {
      await seedDatabase();
      setSeedMsg("DB Seeded!");
      setTimeout(() => setSeedMsg(null), 3000);
    } catch (e) {
      console.error(e);
      setSeedMsg("Error Seeding");
    } finally {
      setIsSeeding(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      {/* Header Image/Art */}
      <div className="h-[35vh] bg-saffron relative overflow-hidden rounded-b-[40px] shadow-lg">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: 'radial-gradient(circle, #fff 2px, transparent 2px)', backgroundSize: '20px 20px' }}></div>
        <div className="absolute bottom-0 w-full h-16 bg-gradient-to-t from-black/10 to-transparent"></div>
        <div className="flex flex-col items-center justify-center h-full text-white pt-8">
          <LotusIcon className="w-16 h-16 mb-4 drop-shadow-lg" />
          <h1 className="font-header font-bold text-3xl">Welcome</h1>
          <p className="opacity-90">Sign in to coordinate your seva</p>
        </div>
      </div>

      <div className="flex-1 px-6 -mt-10">
        <div className="clay-card clay-card-lg min-h-[300px]">
          {error && (
            <div className="mb-6 p-3 bg-red-50 text-red-600 text-sm rounded-xl flex items-start gap-2 border border-red-100 animate-in slide-in-from-top-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Google Login Button */}
          <button
            onClick={handleGoogleLogin}
            className="clay-button-secondary w-full mb-6"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            Sign in with Google
          </button>

          <div className="flex items-center gap-2 mb-6 opacity-50">
            <div className="h-px bg-gray-300 flex-1"></div>
            <span className="text-xs font-bold text-gray-500">OR WITH EMAIL</span>
            <div className="h-px bg-gray-300 flex-1"></div>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            <div>
              <label className="block text-xs font-bold text-coffee mb-1 ml-1 uppercase">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-3.5 text-gray-400" size={18} />
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="clay-input pl-10"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-bold text-coffee mb-1 ml-1 uppercase">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-3.5 text-gray-400" size={18} />
                <input
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="clay-input pl-10"
                  required
                  minLength={6}
                />
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="clay-button-primary w-full mt-4 disabled:opacity-50"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : (
                isRegistering ? <><UserPlus size={18} /> Create Account</> : <>Login <ChevronRight size={18} /></>
              )}
            </button>
          </form>

          <div className="text-center mt-6">
            <button
              onClick={() => { setIsRegistering(!isRegistering); setError(null); }}
              className="text-sm text-gray-500 hover:text-saffron font-medium"
            >
              {isRegistering ? "Already have an account? Login" : "New to Sabha? Create Account"}
            </button>
          </div>
        </div>

        <p className="text-center text-gray-400 text-xs mt-8">
          By continuing, you agree to our Terms of Seva and Privacy Policy.
        </p>

        {/* Developer Tool: Seed Button */}
        <div className="text-center mt-6 mb-4">
          <button
            onClick={handleSeed}
            disabled={isSeeding}
            className="text-[10px] text-gray-300 hover:text-saffron flex items-center justify-center gap-1 mx-auto transition-colors"
          >
            {isSeeding ? <Loader2 size={10} className="animate-spin" /> : <Database size={10} />}
            {seedMsg || "Dev: Seed Database"}
          </button>
        </div>
      </div>
    </div>
  );
};
