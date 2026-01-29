import React, { useState, useEffect } from 'react';
import { DriverAssignment, TabView, Driver } from './types';
import { SplashScreen } from './components/auth/SplashScreen';
import { LoginScreen } from './components/auth/LoginScreen';
import { RoleSelection } from './components/auth/RoleSelection';
import { ProfileSetup } from './components/auth/ProfileSetup';
import { PendingApproval } from './components/auth/PendingApproval';
import { StudentDashboard } from './components/student/StudentDashboard';
import { DriverDashboard } from './components/driver/DriverDashboard';
import { AssignmentDetail } from './components/driver/AssignmentDetail';
import { DriverHistory } from './components/driver/DriverHistory';
import { ManagerDashboard } from './components/manager/ManagerDashboard';
import { ResponsiveLayout } from './components/Layout';
import { PWAPrompt } from './components/PWAPrompt';
import { OmWatermark } from './constants';
import { useAuth } from './contexts/AuthContext';
import { useNavigation } from './contexts/NavigationContext';

export default function App() {
  const { currentUser, userProfile, loading, logout, activeRole } = useAuth();
  const { currentTab } = useNavigation();
  const [showSplash, setShowSplash] = useState(true);

  // Local state for specific sub-views that aren't global tabs
  const [selectedAssignment, setSelectedAssignment] = useState<DriverAssignment | null>(null);

  // Note: Automatic splash timer removed to favor user-initiated transition

  if (loading || showSplash) {
    return <SplashScreen onFinish={() => setShowSplash(false)} />;
  }

  if (!currentUser) {
    return <LoginScreen onLoginSuccess={() => { }} />;
  }

  if (!userProfile || !userProfile.role) {
    return <RoleSelection onSelectRole={() => { }} />;
  }

  if (!userProfile.name || !userProfile.address) {
    const userEmail = currentUser.email || userProfile.email || "";
    return <ProfileSetup role={userProfile.role} email={userEmail} onComplete={() => { }} />;
  }

  if (userProfile.accountStatus === 'pending') {
    return <PendingApproval role={userProfile.role} onBack={logout} />;
  }

  // Use activeRole for rendering dashboards (allows role switching)
  const displayRole = activeRole || userProfile.role;

  const renderContent = () => {
    if (displayRole === 'student') {
      return <StudentDashboard user={userProfile} />;
    }

    if (displayRole === 'manager') {
      return <ManagerDashboard />;
    }

    if (displayRole === 'driver') {
      if (selectedAssignment) {
        return <AssignmentDetail assignment={selectedAssignment} onBack={() => setSelectedAssignment(null)} />;
      }
      switch (currentTab) {
        case 'home': return <DriverDashboard onSelectAssignment={setSelectedAssignment} />;
        case 'history': return <DriverHistory />;
        case 'profile': return (
          <div className="p-12 text-center animate-in fade-in duration-500">
            <img src={userProfile.avatarUrl} className="w-32 h-32 rounded-3xl mx-auto mb-6 border-4 border-white shadow-xl" alt="Profile" />
            <h2 className="text-3xl font-header font-bold text-coffee">{userProfile.name}</h2>
            <p className="text-gold font-bold uppercase tracking-widest mt-1">Volunteer Driver</p>
          </div>
        );
        default: return <DriverDashboard onSelectAssignment={setSelectedAssignment} />;
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