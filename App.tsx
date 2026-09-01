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
import { NotificationSettingsPage } from './components/manager/NotificationSettings';
import { FleetManagement } from './components/manager/FleetManagement';
import { ManagerRecords } from './components/manager/ManagerRecords';
import { ManagerNotices } from './components/manager/ManagerNotices';
// import { CleanupUtility } from './components/admin/CleanupUtility'; // removed — component does not exist
import { AirportShell } from './components/airport/AirportShell';
import { arrivingMember } from './src/constants/service';
import { useService } from './hooks/useService';
import { ResponsiveLayout } from './components/Layout';
import { ProfileEditor } from './components/shared/ProfileEditor';
import { PWAPrompt } from './components/PWAPrompt';
import { UpdateBanner } from './components/UpdateBanner';
import { PushMessages } from './components/PushMessages';
import { OmWatermark } from './constants';
import { useAuth } from './contexts/AuthContext';
import { useNavigation } from './contexts/NavigationContext';

export default function App() {
  const { currentUser, userProfile, loading, logout, refreshProfile } = useAuth();
  const { currentTab } = useNavigation();
  const [showSplash, setShowSplash] = useState(true);
  const { service, role: displayRole } = useService();

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

  // A NAME IS ALWAYS REQUIRED. AN ADDRESS IS NOT, IF THEY HAVE NOT ARRIVED.
  //
  // ProfileSetup will not let anybody past without an address picked from Google Places
  // suggestions, with coordinates. For somebody still in India that is either a dead end
  // or — worse — their Ahmedabad address geocoded into `location`, which
  // `resolveHomeCoords` would then hand to a Sarthi as a Friday pickup point.
  //
  // They get asked for one the moment they stop arriving: clearing `isArriving` drops
  // them back through this same gate, which is exactly when a home address starts to
  // mean something. The server also seeds it from their pickup's destination on
  // completion, so most people never see the screen at all.
  const arriving = arrivingMember(userProfile);
  if (!userProfile.name || (!userProfile.address && !arriving)) {
    const userEmail = currentUser.email || userProfile.email || "";
    return <ProfileSetup role={userProfile.role} email={userEmail} arriving={arriving} onComplete={() => refreshProfile()} />;
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
          <button onClick={logout} className="clay-button w-full py-3 text-[rgb(var(--text-on-accent))] bg-[rgb(var(--danger-fill))] rounded-xl font-bold">
            Sign Out
          </button>
        </div>
      </div>
    );
  }

  // `displayRole` comes from useService now, which derives it the same way this line
  // used to (activeRole, falling back to the recorded role) and ALSO uses it to pick
  // which Airport Seva to render. One derivation, so the nav and the screen cannot
  // disagree about whether a manager sees the board or a newcomer's request form.

  // WHICH SERVICE, before which role.
  //
  // Airport Seva is the whole app for somebody who has not arrived yet, and is not a
  // destination for anybody else — so the service is DERIVED from the profile rather
  // than chosen. The launcher that used to stand here, asking everybody which service
  // they wanted, is deleted: a student who has lived here two years has no use for an
  // Airport tab, and somebody in India has no use for a lift to sabha.
  //
  // Only somebody who can DRIVE can override, and `resolveService` drops the override
  // for anybody else rather than trusting the caller. So a Bhulku has one service and no
  // way to ask for the other. See src/constants/service.ts.
  //
  // The sabha branch below is untouched by all of this.

  const renderContent = () => {
    if (service === 'airport') {
      return <AirportShell />;
    }

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
        case 'fleet':
          return <FleetManagement />;
        case 'notices':
          return <ManagerNotices />;
        case 'notifications':
          return <NotificationSettingsPage service="sabha" />;
        case 'records':
          // Wrapped, not the bare console: ManagerRecords carries the warning
          // that used to live on Setup's accordion row. See that file.
          return <ManagerRecords />;
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
      {/* No UI. Subscribes to push that arrives while the app is open,
          which FCM otherwise delivers and drops. */}
      <PushMessages />
      <PWAPrompt />
      <OmWatermark />
      <ResponsiveLayout role={displayRole}>
        {renderContent()}
      </ResponsiveLayout>
    </div>
  );
}