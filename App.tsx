import React, { useState } from 'react';

import { SplashScreen } from './components/auth/SplashScreen';
import { LoginScreen } from './components/auth/LoginScreen';
import { EmailVerificationScreen } from './components/auth/EmailVerificationScreen';
import { RoleSelection } from './components/auth/RoleSelection';
import { ProfileSetup } from './components/auth/ProfileSetup';
import { PendingApproval } from './components/auth/PendingApproval';
import { StudentDashboard } from './components/student/StudentDashboard';
import { DriverDashboard } from './components/driver/DriverDashboard';
import { DriverHistory } from './components/driver/DriverHistory';
import { ManagerDashboard } from './components/manager/ManagerDashboard';
import { ManagerReports } from './components/manager/ManagerReports';
import { ManagerPeople } from './components/manager/ManagerPeople';
import { ManagerSetup } from './components/manager/ManagerSetup';
// import { CleanupUtility } from './components/admin/CleanupUtility'; // removed — component does not exist
import { ResponsiveLayout } from './components/Layout';
import { ProfileEditor } from './components/shared/ProfileEditor';
import { PWAPrompt } from './components/PWAPrompt';
import { UpdateBanner } from './components/UpdateBanner';
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

  if (currentUser && !currentUser.emailVerified) {
    return <EmailVerificationScreen onBack={logout} />;
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
      <div className="min-h-screen flex items-center justify-center bg-cream p-6">
        <div className="clay-card p-8 text-center max-w-md">
          <div className="text-6xl mb-4">🚫</div>
          <h2 className="text-2xl font-header font-bold text-coffee mb-2">Account Not Approved</h2>
          <p className="text-coffee-500 mb-6">Your account registration was not approved. If you believe this is an error, please contact the seva coordinator.</p>
          <button onClick={logout} className="clay-button w-full py-3 text-white bg-gradient-to-r from-[rgb(var(--danger))] to-[rgb(var(--danger))] rounded-xl font-bold">
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
        case 'people':
          return <ManagerPeople />;
        case 'history':
          return <ManagerReports />;
        case 'setup':
          return <ManagerSetup />;
        case 'profile':
          return <ProfileEditor />;
        default:
          return <ManagerDashboard />;
      }
    }

    if (displayRole === 'driver') {
      // Driver flow - no vehicle selection required after fleet management removal
      switch (currentTab) {
        case 'home': return <DriverDashboard />;
        case 'history': return <DriverHistory />;
        case 'profile': return <ProfileEditor />;
        default: return <DriverDashboard />;
      }
    }
    return null;
  };

  return (
    <div className="relative">
      <UpdateBanner />
      <PWAPrompt />
      <OmWatermark />
      <ResponsiveLayout role={displayRole}>
        {renderContent()}
      </ResponsiveLayout>
    </div>
  );
}