import React, { createContext, useContext, useState, useEffect } from 'react';
import { TabView } from '../types';

interface NavigationContextType {
  currentTab: TabView;
  setCurrentTab: (tab: TabView) => void;
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
    <NavigationContext.Provider value={{ currentTab, setCurrentTab, isSidebarCollapsed, toggleSidebar, isFocusMode, setFocusMode }}>
      {children}
    </NavigationContext.Provider>
  );
};