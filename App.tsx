import React, { useState, useEffect } from 'react';
import { TabView, Driver } from './types';
import { SplashScreen } from './components/auth/SplashScreen';
import { LoginScreen } from './components/auth/LoginScreen';
import { RoleSelection } from './components/auth/RoleSelection';
import { ProfileSetup } from './components/auth/ProfileSetup';
import { PendingApproval } from './components/auth/PendingApproval';
import { StudentDashboard } from './components/student/StudentDashboard';
import { DriverDashboard } from './components/driver/DriverDashboard';
import { DriverHistory } from './components/driver/DriverHistory';
import { ManagerDashboard } from './components/manager/ManagerDashboard';
import { ManagerReports } from './components/manager/ManagerReports';
// import { CleanupUtility } from './components/admin/CleanupUtility'; // removed — component does not exist
import { ResponsiveLayout } from './components/Layout';
import { PWAPrompt } from './components/PWAPrompt';
import { OmWatermark } from './constants';
import { useAuth } from './contexts/AuthContext';
import { useNavigation } from './contexts/NavigationContext';

export default function App() {
  const { currentUser, userProfile, loading, logout, activeRole, refreshProfile } = useAuth();
  const { currentTab } = useNavigation();
  const [showSplash, setShowSplash] = useState(true);

  // Note: Automatic splash timer removed to favor user-initiated transition

  if (loading || showSplash) {
    return <SplashScreen onComplete={() => setShowSplash(false)} />;
  }

  if (!currentUser) {
    return <LoginScreen onLoginSuccess={() => { }} />;
  }

  if (!userProfile || !userProfile.role) {
    return <RoleSelection onSelectRole={() => refreshProfile()} />;
  }

  if (!userProfile.name || !userProfile.address) {
    const userEmail = currentUser.email || userProfile.email || "";
    return <ProfileSetup role={userProfile.role} email={userEmail} onComplete={() => refreshProfile()} />;
  }

  if (userProfile.accountStatus === 'pending') {
    return <PendingApproval role={userProfile.role} onBack={logout} />;
  }

  if (userProfile.accountStatus === 'rejected') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-amber-50 to-orange-50 p-6">
        <div className="clay-card p-8 text-center max-w-md">
          <div className="text-6xl mb-4">🚫</div>
          <h2 className="text-2xl font-header font-bold text-coffee mb-2">Account Not Approved</h2>
          <p className="text-mocha/60 mb-6">Your account registration was not approved. If you believe this is an error, please contact the seva coordinator.</p>
          <button onClick={logout} className="clay-button w-full py-3 text-white bg-gradient-to-r from-red-400 to-red-500 rounded-xl font-bold">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // Use activeRole for rendering dashboards (allows role switching)
  const displayRole = activeRole || userProfile.role;

  const renderContent = () => {
    if (displayRole === 'student') {
      return <StudentDashboard user={userProfile} onLogout={logout} />;
    }

    if (displayRole === 'manager') {
      switch (currentTab) {
        case 'home':
          return <ManagerDashboard />;
        case 'history':
          return <ManagerReports />;
        case 'profile':
          return (
            <div className="p-12 text-center animate-in fade-in duration-500">
              <img src={userProfile.avatarUrl} className="w-32 h-32 rounded-3xl mx-auto mb-6 border-4 border-white shadow-xl" alt="Profile" />
              <h2 className="text-3xl font-header font-bold text-coffee">{userProfile.name}</h2>
              <p className="text-gold font-bold uppercase tracking-widest mt-1">Seva Manager</p>
              {userProfile.phone && (
                <div className="mt-6 max-w-sm mx-auto clay-card flex items-center gap-4 text-left p-4">
                  <div className="bg-orange-50 p-2 rounded-xl text-saffron">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
                    </svg>
                  </div>
                  <p className="text-sm text-mocha/70">{userProfile.phone}</p>
                </div>
              )}
              {userProfile.address && (
                <div className="mt-4 max-w-sm mx-auto clay-card flex items-center gap-4 text-left p-4">
                  <div className="bg-orange-50 p-2 rounded-xl text-saffron">
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                      <circle cx="12" cy="10" r="3" />
                    </svg>
                  </div>
                  <p className="text-sm text-mocha/70 line-clamp-2">{userProfile.address}</p>
                </div>
              )}

              {/* Cleanup Utility - Removed (component does not exist) */}

            </div>
          );
        default:
          return <ManagerDashboard />;
      }
    }

    if (displayRole === 'driver') {
      // Driver flow - no vehicle selection required after fleet management removal
      switch (currentTab) {
        case 'home': return <DriverDashboard />;
        case 'history': return <DriverHistory />;
        case 'profile': return (
          <div className="p-12 text-center animate-in fade-in duration-500">
            <img src={userProfile.avatarUrl} className="w-32 h-32 rounded-3xl mx-auto mb-6 border-4 border-white shadow-xl" alt="Profile" />
            <h2 className="text-3xl font-header font-bold text-coffee">{userProfile.name}</h2>
            <p className="text-gold font-bold uppercase tracking-widest mt-1">Volunteer Driver</p>
            {userProfile.email && (
              <div className="mt-6 max-w-sm mx-auto clay-card flex items-center gap-4 text-left p-4">
                <div className="bg-orange-50 p-2 rounded-xl text-saffron">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect width="20" height="16" x="2" y="4" rx="2" /><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" /></svg>
                </div>
                <p className="text-sm text-mocha/70">{userProfile.email}</p>
              </div>
            )}
            {userProfile.phone && (
              <div className="mt-4 max-w-sm mx-auto clay-card flex items-center gap-4 text-left p-4">
                <div className="bg-orange-50 p-2 rounded-xl text-saffron">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" /></svg>
                </div>
                <p className="text-sm text-mocha/70">{userProfile.phone}</p>
              </div>
            )}
            {userProfile.address && (
              <div className="mt-4 max-w-sm mx-auto clay-card flex items-center gap-4 text-left p-4">
                <div className="bg-orange-50 p-2 rounded-xl text-saffron">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>
                </div>
                <p className="text-sm text-mocha/70 line-clamp-2">{userProfile.address}</p>
              </div>
            )}
            <button onClick={logout} className="mt-8 max-w-sm mx-auto clay-button w-full py-3 text-white bg-gradient-to-r from-red-400 to-red-500 rounded-xl font-bold shadow-lg">
              Sign Out
            </button>
          </div>
        );
        default: return <DriverDashboard />;
      }
    }
    return null;
  };

  return (
    <div className="relative">
      <PWAPrompt />
      <OmWatermark />
      <ResponsiveLayout role={displayRole}>
        {renderContent()}
      </ResponsiveLayout>
    </div>
  );
}