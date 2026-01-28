import React, { createContext, useContext, useState, useEffect } from 'react';
import { TabView } from '../types';

interface NavigationContextType {
  currentTab: TabView;
  setCurrentTab: (tab: TabView) => void;
  isSidebarCollapsed: boolean;
  toggleSidebar: () => void;
}

const NavigationContext = createContext<NavigationContextType | undefined>(undefined);

export const useNavigation = () => {
  const context = useContext(NavigationContext);
  if (!context) throw new Error('useNavigation must be used within a NavigationProvider');
  return context;
};

export const NavigationProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [currentTab, setCurrentTab] = useState<TabView>('home');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', JSON.stringify(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  const toggleSidebar = () => setIsSidebarCollapsed((prev: boolean) => !prev);

  return (
    <NavigationContext.Provider value={{ currentTab, setCurrentTab, isSidebarCollapsed, toggleSidebar }}>
      {children}
    </NavigationContext.Provider>
  );
};