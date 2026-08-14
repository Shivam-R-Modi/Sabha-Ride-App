import React from 'react';
import { LotusIcon } from '../constants';
import { TabView, UserRole } from '../types';
import {
  Home,
  Car,
  User as UserIcon,
  History,
  LayoutDashboard,
  LogOut,
  ChevronLeft,
  ChevronRight,
  Menu,
  ShieldCheck,
  UserCheck,
  Settings
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { RoleSwitcher } from './RoleSwitcher';

interface LayoutProps {
  children: React.ReactNode;
  role: UserRole;
}

export const ResponsiveLayout: React.FC<LayoutProps> = ({ children, role }) => {
  const { userProfile } = useAuth();
  const { isSidebarCollapsed, isFocusMode } = useNavigation();

  // A focus-mode screen owns the viewport: no sidebar, no header, no bottom
  // nav, and no bottom padding reserved for one.
  //
  // THE CHROME IS HIDDEN, THE TREE IS NOT RESHAPED. This used to be an early
  // `return <div>{children}</div>`, which put `children` at a completely
  // different depth from the normal branch:
  //
  //     focus   div > children
  //     normal  div > div > main > div > children
  //
  // React reconciles by position, so flipping the flag UNMOUNTED and REMOUNTED
  // everything below it. ActiveRide sets isFocusMode in a mount effect and
  // clears it on cleanup, so it remounted itself for ever: mount → true →
  // reshape → unmount → false → reshape → mount. The driver saw the page
  // blinking until React gave up with "Maximum update depth exceeded" and the
  // ErrorBoundary swallowed the whole screen — immediately after a successful
  // assignment, with riders already committed to them in Firestore.
  //
  // Keeping one tree and toggling siblings keeps `children` in the same
  // position, so its state and effects survive the switch. Any focus-mode
  // screen is free to set the flag on mount now, which is the only way that
  // pattern can be used safely.
  return (
    <div className="min-h-screen bg-cream flex flex-col lg:flex-row">
      {!isFocusMode && <Sidebar role={role} />}

      <div className={isFocusMode
        ? 'flex-1 flex flex-col'
        : `flex-1 flex flex-col transition-all duration-300 ${isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-60'}`}>
        {!isFocusMode && <MobileHeader userName={userProfile?.name || 'User'} role={role} />}

        <main className={isFocusMode ? 'flex-1' : 'flex-1 pb-safe-nav lg:pb-0'}>
          <div className={isFocusMode ? 'w-full' : 'max-w-7xl mx-auto w-full'}>
            {children}
          </div>
        </main>

        {!isFocusMode && <BottomNav role={role} />}
      </div>
    </div>
  );
};

const MobileHeader: React.FC<{ userName: string; role: UserRole }> = ({ userName, role }) => {
  const { logout } = useAuth();

  return (
    // z-chrome, not z-sticky. `sticky` + a z-index creates a stacking context,
    // so the role menu's z-dropdown was capped at this element's own level —
    // every in-page sticky header (the manager's tab strip, RequestTable,
    // ActiveRide, AssignmentPreview) shares z-sticky and comes later in the
    // DOM, so they all painted over the open menu.
    <header className="app-header lg:hidden sticky top-0 z-chrome bg-cream/80 backdrop-blur-md border-b border-hairline/10 pt-safe">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="bg-saffron/10 p-2 rounded-full">
            <LotusIcon className="w-5 h-5 text-saffron" />
          </div>
          <h1 className="font-header font-bold text-base text-coffee truncate">Sabha Ride Seva</h1>
        </div>
        <div className="flex items-center gap-2">
          <RoleSwitcher />
          <button onClick={logout} className="tap-target p-2 text-coffee-500 hover:text-[rgb(var(--danger-text))] btn-feedback">
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </header>
  );
};

const Sidebar: React.FC<{ role: UserRole }> = ({ role }) => {
  const { logout, userProfile } = useAuth();
  const { currentTab, setCurrentTab, isSidebarCollapsed, toggleSidebar } = useNavigation();

  const navItems = getNavItems(role);

  return (
    // Same rung as the mobile header: it is chrome, and it holds a RoleSwitcher too.
    <aside className={`fixed left-0 top-0 h-full bg-surface border-r border-hairline/10 shadow-xl z-chrome transition-all duration-300 hidden lg:flex flex-col
      ${isSidebarCollapsed ? 'w-20' : 'w-60'}`}>

      {/* Logo Section */}
      <div className="p-6 flex items-center gap-3 overflow-hidden">
        <div className="bg-gradient-to-br from-saffron to-saffron-dark p-2 rounded-xl shadow-lg shrink-0">
          <LotusIcon className="w-6 h-6 text-white" />
        </div>
        {!isSidebarCollapsed && (
          <div className="animate-in fade-in slide-in-from-left-2">
            <h1 className="font-header font-bold text-coffee leading-none">Sabha Ride</h1>
            <p className="text-[10px] text-gold-700 font-bold uppercase tracking-widest mt-1">Seva Portal</p>
          </div>
        )}
      </div>

      {/* Role Switcher */}
      {!isSidebarCollapsed && (
        <div className="px-6 pb-4">
          <RoleSwitcher />
        </div>
      )}

      {/* Nav Links */}
      <nav className="flex-1 px-3 py-4 space-y-2">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id as TabView)}
              title={isSidebarCollapsed ? item.label : undefined}
              className={`w-full flex items-center gap-4 p-3 rounded-2xl transition-all group relative btn-feedback ${isActive
                ? 'bg-cream-300 text-saffron shadow-sm border border-hairline/10'
                : 'text-coffee-500 hover:bg-cream-200 hover:text-coffee'
                }`}
            >
              <Icon size={22} className={`${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
              {!isSidebarCollapsed && (
                <span className={`text-sm font-bold animate-in fade-in slide-in-from-left-2 ${isActive ? 'text-coffee' : ''}`}>
                  {item.label}
                </span>
              )}
              {isActive && (
                <div className="absolute left-0 w-1 h-6 bg-saffron-800 rounded-r-full shadow-lg" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Profile & Footer */}
      <div className="p-4 border-t border-hairline/10 bg-cream/30">
        {!isSidebarCollapsed ? (
          <div className="space-y-4 animate-in fade-in">
            <div className="flex items-center gap-3">
              <img
                src={userProfile?.avatarUrl || `https://ui-avatars.com/api/?name=${userProfile?.name}`}
                className="w-10 h-10 rounded-xl border-2 border-surface shadow-sm"
                alt="Profile"
              />
              <div className="min-w-0">
                <p className="text-sm font-bold text-coffee truncate">{userProfile?.name}</p>
                <p className="text-[10px] text-coffee-500 font-bold uppercase truncate">{role}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-cream-300 hover:bg-[rgb(var(--danger-bg))] hover:text-[rgb(var(--danger-text))] text-coffee-700 rounded-xl text-xs font-bold transition-all group btn-feedback"
            >
              <LogOut size={16} className="group-hover:rotate-12 transition-transform" />
              Sign Out
            </button>
          </div>
        ) : (
          <button
            onClick={logout}
            title="Logout"
            className="w-full flex justify-center p-3 text-coffee-500 hover:text-[rgb(var(--danger-text))] transition-colors btn-feedback"
          >
            <LogOut size={22} />
          </button>
        )}

        {/* Collapse Toggle */}
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-20 bg-surface border border-hairline/10 rounded-full p-1 shadow-md hover:shadow-lg transition-all text-coffee-500 hover:text-saffron z-raised"
        >
          {isSidebarCollapsed ? <ChevronRight size={14} /> : <ChevronLeft size={14} />}
        </button>
      </div>
    </aside>
  );
};

const BottomNav: React.FC<{ role: UserRole }> = ({ role }) => {
  const { currentTab, setCurrentTab } = useNavigation();
  const navItems = getNavItems(role);

  return (
    <nav className="clay-bottom-nav lg:hidden">
      <div className="max-w-md mx-auto flex justify-around items-center h-16 gap-0.5">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id as TabView)}
              className={`relative flex flex-col items-center justify-center h-full w-full transition-all btn-feedback ${isActive ? 'text-saffron-800' : 'text-coffee-500'
                }`}
            >
              <div className={`p-1 rounded-xl transition-all ${isActive ? 'bg-cream-300' : ''}`}>
                <Icon className={`w-6 h-6 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
              </div>
              <span className="text-[10px] mt-1 font-bold uppercase tracking-tighter truncate max-w-full px-0.5">
                {item.label}
              </span>
              {isActive && (
                <div className="absolute top-0 w-1/2 max-w-[40px] h-1 bg-saffron-800 rounded-b-md shadow-[0_2px_10px_rgba(184,67,24,0.4)] animate-in slide-in-from-top-1" />
              )}
            </button>
          );
        })}
      </div>
    </nav>
  );
};

const getNavItems = (role: UserRole) => {
  if (role === 'driver') {
    return [
      { id: 'home', label: 'Dashboard', icon: Home },
      { id: 'history', label: 'History', icon: History },
      { id: 'profile', label: 'Profile', icon: UserIcon },
    ];
  }
  if (role === 'manager') {
    // Five destinations, replacing three nav systems on one screen: this bar,
    // a segmented control, and four unlabelled toolbar icons — among them a
    // map-pin that meant "settings" and a car that meant "fleet".
    return [
      { id: 'home', label: 'Dispatch', icon: LayoutDashboard },
      { id: 'people', label: 'People', icon: UserCheck },
      { id: 'history', label: 'Reports', icon: History },
      { id: 'setup', label: 'Setup', icon: Settings },
      { id: 'profile', label: 'Profile', icon: UserIcon },
    ];
  }
  return [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'rides', label: 'My Rides', icon: Car },
    { id: 'profile', label: 'Profile', icon: UserIcon },
  ];
};