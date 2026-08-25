import React, { createContext, useContext, useState, useEffect } from 'react';
import { Service, TabView } from '../types';

interface NavigationContextType {
  currentTab: TabView;
  setCurrentTab: (tab: TabView) => void;
  /**
   * A manager's momentary switch to the other service, or null for "use the derived one".
   *
   * RAW STATE, and the derivation lives in `hooks/useService.ts` rather than here. This
   * provider deliberately knows nothing about the profile: it used to read `useAuth()` to
   * derive the service, which made every test that renders a NavigationProvider — the
   * PWA install prompt's, among others — need an auth mock it has no business needing.
   *
   * `resolveService` drops this override for anybody who is not an approved manager, so
   * setting it cannot reach a service somebody should not have.
   */
  serviceOverride: Service | null;
  setServiceOverride: (to: Service | null) => void;
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
  /**
   * Hide the shell's nav and header for a screen that owns the whole viewport.
   *
   * Exactly one screen needs this: the driver's active ride. It is a task, not
   * a destination — the driver is mid-run with people waiting — and leaving the
   * bottom nav on screen both invites a tap that abandons the flow and steals
   * 80px of vertical space from a list of stops read at arm's length in a car.
   *
   * It also fixes double chrome: ActiveRide draws its own sticky header
   * underneath the shell's.
   */
  isFocusMode: boolean;
  setFocusMode: (on: boolean) => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNavigation must be used within a NavigationProvider');
  return context;
};

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentTab, setCurrentTab] = useState<TabView>('home');
  const [serviceOverride, setServiceOverride] = useState<Service | null>(null);
  const [isFocusMode, setFocusMode] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', JSON.stringify(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  const toggleSidebar = () => setIsSidebarCollapsed((prev: boolean) => !prev);


  return (
    <NavigationContext.Provider value={{ currentTab, setCurrentTab, serviceOverride, setServiceOverride, isSidebarCollapsed, toggleSidebar, isFocusMode, setFocusMode }}>
      {children}
    </NavigationContext.Provider>
  );
};