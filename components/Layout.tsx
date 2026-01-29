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
  ShieldCheck
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
  const { isSidebarCollapsed } = useNavigation();

  return (
    <div className="min-h-screen bg-cream flex flex-col lg:flex-row">
      <Sidebar role={role} />

      <div className={`flex-1 flex flex-col transition-all duration-300 ${isSidebarCollapsed ? 'lg:pl-20' : 'lg:pl-60'
        }`}>
        <MobileHeader userName={userProfile?.name || 'User'} role={role} />

        <main className="flex-1 pb-20 lg:pb-0">
          <div className="max-w-7xl mx-auto w-full">
            {children}
          </div>
        </main>

        <BottomNav role={role} />
      </div>
    </div>
  );
};

const MobileHeader: React.FC<{ userName: string; role: UserRole }> = ({ userName, role }) => {
  const { logout } = useAuth();

  return (
    <header className="lg:hidden sticky top-0 z-40 bg-cream/80 backdrop-blur-md border-b border-orange-100 pt-safe">
      <div className="px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className="bg-saffron/10 p-2 rounded-full">
            <LotusIcon className="w-5 h-5 text-saffron" />
          </div>
          <h1 className="font-header font-bold text-base text-coffee truncate">Sabha Ride Seva</h1>
        </div>
        <div className="flex items-center gap-2">
          <RoleSwitcher />
          <button onClick={logout} className="p-2 text-gray-400 hover:text-red-500 btn-feedback">
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
    <aside className={`fixed left-0 top-0 h-full bg-white border-r border-orange-50 shadow-xl z-50 transition-all duration-300 hidden lg:flex flex-col
      ${isSidebarCollapsed ? 'w-20' : 'w-60'}`}>

      {/* Logo Section */}
      <div className="p-6 flex items-center gap-3 overflow-hidden">
        <div className="bg-gradient-to-br from-saffron to-saffron-dark p-2 rounded-xl shadow-lg shrink-0">
          <LotusIcon className="w-6 h-6 text-white" />
        </div>
        {!isSidebarCollapsed && (
          <div className="animate-in fade-in slide-in-from-left-2">
            <h1 className="font-header font-bold text-coffee leading-none">Sabha Ride</h1>
            <p className="text-[10px] text-gold font-bold uppercase tracking-widest mt-1">Seva Portal</p>
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
                ? 'bg-orange-50 text-saffron shadow-sm border border-orange-100'
                : 'text-gray-400 hover:bg-gray-50 hover:text-coffee'
                }`}
            >
              <Icon size={22} className={`${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
              {!isSidebarCollapsed && (
                <span className={`text-sm font-bold animate-in fade-in slide-in-from-left-2 ${isActive ? 'text-coffee' : ''}`}>
                  {item.label}
                </span>
              )}
              {isActive && (
                <div className="absolute left-0 w-1 h-6 bg-saffron rounded-r-full shadow-lg" />
              )}
            </button>
          );
        })}
      </nav>

      {/* Profile & Footer */}
      <div className="p-4 border-t border-orange-50 bg-cream/30">
        {!isSidebarCollapsed ? (
          <div className="space-y-4 animate-in fade-in">
            <div className="flex items-center gap-3">
              <img
                src={userProfile?.avatarUrl || `https://ui-avatars.com/api/?name=${userProfile?.name}`}
                className="w-10 h-10 rounded-xl border-2 border-white shadow-sm"
                alt="Profile"
              />
              <div className="min-w-0">
                <p className="text-sm font-bold text-coffee truncate">{userProfile?.name}</p>
                <p className="text-[10px] text-gray-400 font-bold uppercase truncate">{role}</p>
              </div>
            </div>
            <button
              onClick={logout}
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-gray-100 hover:bg-red-50 hover:text-red-600 text-gray-600 rounded-xl text-xs font-bold transition-all group btn-feedback"
            >
              <LogOut size={16} className="group-hover:rotate-12 transition-transform" />
              Sign Out
            </button>
          </div>
        ) : (
          <button
            onClick={logout}
            title="Logout"
            className="w-full flex justify-center p-3 text-gray-400 hover:text-red-600 transition-colors btn-feedback"
          >
            <LogOut size={22} />
          </button>
        )}

        {/* Collapse Toggle */}
        <button
          onClick={toggleSidebar}
          className="absolute -right-3 top-20 bg-white border border-orange-100 rounded-full p-1 shadow-md hover:shadow-lg transition-all text-gray-400 hover:text-saffron z-50"
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
      <div className="max-w-md mx-auto flex justify-around items-center h-16">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => setCurrentTab(item.id as TabView)}
              className={`relative flex flex-col items-center justify-center h-full w-full transition-all btn-feedback ${isActive ? 'text-saffron' : 'text-gray-400'
                }`}
            >
              <div className={`p-1 rounded-xl transition-all ${isActive ? 'bg-orange-50' : ''}`}>
                <Icon className={`w-6 h-6 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
              </div>
              <span className={`text-[10px] mt-1 font-bold uppercase tracking-tighter ${isActive ? 'opacity-100' : 'opacity-70'}`}>
                {item.label}
              </span>
              {isActive && (
                <div className="absolute top-0 w-1/2 max-w-[40px] h-1 bg-saffron rounded-b-md shadow-[0_2px_10px_rgba(255,107,53,0.4)] animate-in slide-in-from-top-1" />
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
    return [
      { id: 'home', label: 'Admin', icon: LayoutDashboard },
      { id: 'history', label: 'Reports', icon: History },
      { id: 'profile', label: 'Profile', icon: UserIcon },
    ];
  }
  return [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'rides', label: 'My Rides', icon: Car },
    { id: 'profile', label: 'Profile', icon: UserIcon },
  ];
};