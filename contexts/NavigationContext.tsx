import React, { createContext, useContext, useState, useEffect } from 'react';
import { Service, TabView } from '../types';
import { SERVICE_STORAGE_KEY, serviceHome } from '../src/constants/service';

interface NavigationContextType {
  currentTab: TabView;
  setCurrentTab: (tab: TabView) => void;
  /**
   * Which of the two services is showing. `null` means nobody has chosen yet, and
   * App renders the launcher.
   *
   * Remembered in localStorage, so the launcher is seen once rather than being a tap
   * every session — and switching is a menu item, not a screen you have to go back to.
   */
  service: Service | null;
  /**
   * Choose a service. ALSO RESETS `currentTab`, and that is not a convenience.
   *
   * The sabha tabs and the airport tabs share one `TabView` union, so without the
   * reset a manager switching from `airport-board` to Sabha would land on a
   * `switch (currentTab)` with no matching case and fall through to its default —
   * a silently wrong screen. And the mobile dock highlights `currentTab === item.id`,
   * so with no matching item it would show nothing selected until the first tap.
   *
   * `canSeeBoard` decides where Airport opens: a Bhulku has no board to look at, so
   * sending them to one would open the service on a page they cannot use.
   */
  setService: (service: Service, canSeeBoard: boolean) => void;
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
  const [service, setServiceState] = useState<Service | null>(() => {
    const saved = localStorage.getItem(SERVICE_STORAGE_KEY);
    return saved === 'sabha' || saved === 'airport' ? saved : null;
  });
  const [isFocusMode, setFocusMode] = useState(false);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
    const saved = localStorage.getItem('sidebar_collapsed');
    return saved ? JSON.parse(saved) : false;
  });

  useEffect(() => {
    localStorage.setItem('sidebar_collapsed', JSON.stringify(isSidebarCollapsed));
  }, [isSidebarCollapsed]);

  const toggleSidebar = () => setIsSidebarCollapsed((prev: boolean) => !prev);

  const setService = (next: Service, canSeeBoard: boolean) => {
    setServiceState(next);
    setCurrentTab(serviceHome(next, canSeeBoard));
    localStorage.setItem(SERVICE_STORAGE_KEY, next);
  };

  return (
    <NavigationContext.Provider value={{ currentTab, setCurrentTab, service, setService, isSidebarCollapsed, toggleSidebar, isFocusMode, setFocusMode }}>
      {children}
    </NavigationContext.Provider>
  );
};