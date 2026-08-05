
import React, { useState } from 'react';
import { ChevronRight, Loader2, AlertCircle, Mail, Lock, UserPlus, Eye, EyeOff, CheckCircle2 } from 'lucide-react';
import { signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword, sendEmailVerification } from 'firebase/auth';
import { auth, googleProvider } from '../../firebase/config';
import { evaluatePasswordStrength } from '../../src/utils/passwordUtils';
import { ForgotPasswordModal } from './ForgotPasswordModal';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

interface LoginScreenProps {
  onLoginSuccess: (email: string) => void;
}

export const LoginScreen: React.FC<LoginScreenProps> = ({ onLoginSuccess }) => {
  const [isRegistering, setIsRegistering] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [agreedToTerms, setAgreedToTerms] = useState(false);
  const [isForgotModalOpen, setIsForgotModalOpen] = useState(false);

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadingTimeout, setLoadingTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  const passwordEvaluation = evaluatePasswordStrength(password);

  const handleGoogleLogin = async () => {
    setIsLoading(true);
    setError(null);
    // Set a timeout to auto-cancel loading after 15s
    const timeout = setTimeout(() => {
      setIsLoading(false);
      setError('Sign-in is taking too long. Please try again.');
    }, 15000);
    setLoadingTimeout(timeout);
    try {
      await signInWithPopup(auth, googleProvider);
      // Auth listener in App.tsx handles redirect
    } catch (err: any) {
      clearTimeout(timeout);
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

    const trimmedEmail = email.trim();
    if (!EMAIL_REGEX.test(trimmedEmail)) {
      setError("Please enter a valid email address (e.g., name@example.com).");
      return;
    }

    if (isRegistering) {
      if (!passwordEvaluation.isValid) {
        setError("Password must be at least 8 characters and include a number or special character.");
        return;
      }

      if (password !== confirmPassword) {
        setError("Passwords do not match. Please verify both password fields.");
        return;
      }

      if (!agreedToTerms) {
        setError("Please accept the Terms of Seva and Privacy Policy to register.");
        return;
      }
    }

    setIsLoading(true);
    setError(null);

    try {
      if (isRegistering) {
        const userCredential = await createUserWithEmailAndPassword(auth, trimmedEmail, password);
        // Send email verification link to newly registered user
        try {
          await sendEmailVerification(userCredential.user);
        } catch (verifyError) {
          console.error("Failed to send initial verification email:", verifyError);
        }
      } else {
        await signInWithEmailAndPassword(auth, trimmedEmail, password);
      }
      // Auth listener handles redirect
    } catch (err: any) {
      console.error(err);
      setIsLoading(false);
      if (err.code === 'auth/invalid-email') {
        setError("Invalid email address format.");
      } else if (err.code === 'auth/user-not-found' || err.code === 'auth/wrong-password' || err.code === 'auth/invalid-credential') {
        setError("Invalid email or password.");
      } else if (err.code === 'auth/email-already-in-use') {
        setError("Email is already registered. Please login.");
      } else if (err.code === 'auth/weak-password') {
        setError("Password should be at least 8 characters with numbers or special symbols.");
      } else if (err.code === 'auth/unauthorized-domain') {
        setError("Domain Error: Add this domain to Firebase Console > Auth > Settings > Authorized Domains.");
      } else {
        setError(err.message || "Authentication failed.");
      }
    }
  };

  return (
    <div className="min-h-screen bg-cream flex flex-col">
      {/* Forgot Password Modal */}
      <ForgotPasswordModal
        isOpen={isForgotModalOpen}
        onClose={() => setIsForgotModalOpen(false)}
        initialEmail={email}
      />

      {/* Header Image/Art */}
      <div className="h-[26vh] relative overflow-hidden rounded-b-[40px] shadow-lg">
        {/* Background Image */}
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: 'url(/assets/login-background.jpg)', backgroundColor: '#C2884A' }}
        ></div>
        {/* Gradient Overlay for better text readability */}
        <div className="absolute inset-0 bg-gradient-to-b from-black/20 to-black/30"></div>
        {/* Text Content - centered */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-white z-10">
          <h1 className="font-cursive text-4xl md:text-5xl font-bold drop-shadow-[0_1px_3px_rgba(255,255,255,0.6)] tracking-wide text-[#B84318]">
            Jai Swaminarayan!
          </h1>
          <p className="mt-1 drop-shadow-md text-sm md:text-base font-semibold opacity-95 text-coffee">Sign in to coordinate your seva</p>
        </div>
      </div>

      <div className="flex-1 px-6 my-6">
        <div className="clay-card clay-card-lg max-w-md mx-auto">
          {error && (
            <div className="mb-5 p-3 bg-red-50 text-red-600 text-sm rounded-xl flex items-start gap-2 border border-red-100 animate-in slide-in-from-top-2">
              <AlertCircle size={16} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Google Login Button */}
          <button
            onClick={handleGoogleLogin}
            className="clay-button-secondary w-full mb-5"
          >
            <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" className="w-5 h-5" alt="Google" />
            Sign in with Google
          </button>

          <div className="flex items-center gap-2 mb-5 opacity-50">
            <div className="h-px bg-gray-300 flex-1"></div>
            <span className="text-xs font-bold text-gray-500">OR WITH EMAIL</span>
            <div className="h-px bg-gray-300 flex-1"></div>
          </div>

          <form onSubmit={handleEmailAuth} className="space-y-4">
            {/* Email Field */}
            <div>
              <label className="block text-xs font-bold text-coffee mb-1 ml-1 uppercase">Email Address</label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
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

            {/* Password Field */}
            <div>
              <label className="block text-xs font-bold text-coffee mb-1 ml-1 uppercase">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                <input
                  type={showPassword ? 'text' : 'password'}
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="clay-input pl-10 pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-coffee transition-colors"
                  title={showPassword ? 'Hide Password' : 'Show Password'}
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>

              {/* Password Strength Meter (Sign Up Only) */}
              {isRegistering && password.length > 0 && (
                <div className="mt-2 space-y-1.5 animate-in fade-in duration-200">
                  <div className="flex items-center justify-between text-[11px] font-semibold">
                    <span className="text-coffee-500">Password Strength:</span>
                    <span className={
                      passwordEvaluation.score === 'strong' ? 'text-green-600' :
                      passwordEvaluation.score === 'fair' ? 'text-amber-600' : 'text-red-500'
                    }>
                      {passwordEvaluation.label}
                    </span>
                  </div>

                  <div className="h-1.5 w-full bg-gray-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full transition-all duration-300 ${
                        passwordEvaluation.score === 'strong' ? 'bg-green-500' :
                        passwordEvaluation.score === 'fair' ? 'bg-amber-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${passwordEvaluation.percentage}%` }}
                    ></div>
                  </div>

                  {/* Requirements checklist */}
                  <div className="grid grid-cols-2 gap-1 pt-1 text-[10px] text-coffee-700">
                    <span className={passwordEvaluation.criteria.hasMinLength ? 'text-green-600 font-semibold' : ''}>
                      {passwordEvaluation.criteria.hasMinLength ? '✓' : '•'} 8+ characters
                    </span>
                    <span className={passwordEvaluation.criteria.hasNumber ? 'text-green-600 font-semibold' : ''}>
                      {passwordEvaluation.criteria.hasNumber ? '✓' : '•'} At least 1 number
                    </span>
                    <span className={passwordEvaluation.criteria.hasSpecialChar ? 'text-green-600 font-semibold' : ''}>
                      {passwordEvaluation.criteria.hasSpecialChar ? '✓' : '•'} 1 special character
                    </span>
                    <span className={passwordEvaluation.criteria.hasUppercase ? 'text-green-600 font-semibold' : ''}>
                      {passwordEvaluation.criteria.hasUppercase ? '✓' : '•'} 1 uppercase letter
                    </span>
                  </div>
                </div>
              )}
            </div>

            {/* Confirm Password Field (Sign Up Only) */}
            {isRegistering && (
              <div className="animate-in slide-in-from-top-2 duration-200">
                <label className="block text-xs font-bold text-coffee mb-1 ml-1 uppercase">Confirm Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" size={18} />
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={`clay-input pl-10 pr-10 ${
                      confirmPassword && confirmPassword !== password ? 'border-red-400 focus:border-red-500' : ''
                    }`}
                    required
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-coffee transition-colors"
                    title={showConfirmPassword ? 'Hide Password' : 'Show Password'}
                  >
                    {showConfirmPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                  </button>
                </div>
                {confirmPassword && confirmPassword !== password && (
                  <p className="text-[11px] text-red-500 font-medium mt-1">Passwords do not match</p>
                )}
                {confirmPassword && confirmPassword === password && (
                  <p className="text-[11px] text-green-600 font-medium mt-1 flex items-center gap-1">
                    <CheckCircle2 size={12} /> Passwords match
                  </p>
                )}
              </div>
            )}

            {/* Terms & Privacy Consent Checkbox (Sign Up Only) */}
            {isRegistering && (
              <div className="flex items-start gap-2 pt-1 animate-in fade-in duration-200">
                <input
                  type="checkbox"
                  id="terms"
                  checked={agreedToTerms}
                  onChange={(e) => setAgreedToTerms(e.target.checked)}
                  className="mt-0.5 rounded border-mocha/30 text-saffron focus:ring-saffron cursor-pointer"
                  required
                />
                <label htmlFor="terms" className="text-xs text-coffee-700 leading-tight cursor-pointer">
                  I agree to the <span className="font-bold text-coffee">Terms of Seva</span> and <span className="font-bold text-coffee">Privacy Policy</span>.
                </label>
              </div>
            )}

            <button
              type="submit"
              disabled={isLoading || (isRegistering && (!agreedToTerms || password !== confirmPassword || !passwordEvaluation.isValid))}
              className="clay-button-primary w-full mt-4 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isLoading ? <Loader2 className="animate-spin" /> : (
                isRegistering ? <><UserPlus size={18} /> Create Account</> : <>Login <ChevronRight size={18} /></>
              )}
            </button>
          </form>

          <div className="text-center mt-6">
            <button
              onClick={() => {
                setIsRegistering(!isRegistering);
                setError(null);
                setPassword('');
                setConfirmPassword('');
              }}
              className="text-sm text-gray-500 hover:text-saffron-800 font-medium"
            >
              {isRegistering ? "Already have an account? Login" : "New to Sabha? Create Account"}
            </button>
            {!isRegistering && (
              <button
                onClick={() => setIsForgotModalOpen(true)}
                className="block mx-auto mt-2 text-sm text-saffron-800 hover:text-coffee font-medium"
                type="button"
              >
                Forgot Password?
              </button>
            )}
          </div>
        </div>

        <p className="text-center text-gray-500 text-xs mt-8">
          By continuing, you agree to our Terms of Seva and Privacy Policy.
        </p>

      </div>
    </div>
  );
};

