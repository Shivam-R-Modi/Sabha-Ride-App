import React, { useEffect, useRef, useState } from 'react';
import { LotusIcon } from '../constants';
import { Service, TabView, UserRole } from '../types';
import { Home, Car, User as UserIcon, History, LayoutDashboard, LogOut, ChevronLeft, ChevronRight, UserCheck, Settings, Database, Megaphone, Plane, Repeat, CalendarDays, Ticket } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigation } from '../contexts/NavigationContext';
import { RoleSwitcher } from './RoleSwitcher';
import { InstallAppButton } from './shared/InstallAppButton';
import { SERVICE_LABEL } from '../src/constants/service';
import { useService } from '../hooks/useService';

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
        {!isFocusMode && <MobileHeader />}

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

/**
 * Move between the two services. MANAGERS ONLY.
 *
 * It used to render for everybody, which was the whole bug: a student who has lived here
 * two years got an Airport tab they will never use, and somebody still in India got
 * offered lifts to a sabha they cannot attend. Service is derived from the profile now —
 * see src/constants/service.ts — and this is the one exception, so a manager taking a
 * support call can see what a newcomer sees.
 *
 * `canSwitch` comes from the context, which gets it from `canSwitchService`. Not a local
 * role check: the same predicate has to decide whether the control renders AND whether
 * `resolveService` honours the override, or one of them is a lie.
 *
 * ALWAYS VISIBLE — header and sidebar, never only the dock's overflow drawer. That
 * drawer opens on a swipe and nothing else, an owner decision recorded on GrabHandle
 * below, so a switch that lived only there would be unreachable by keyboard, switch
 * access or VoiceOver.
 */
const ServiceSwitch: React.FC<{ compact?: boolean }> = ({ compact }) => {
  const { service, switchService, canSwitch } = useService();
  if (!canSwitch) return null;

  const other: Service = service === 'sabha' ? 'airport' : 'sabha';
  const Icon = other === 'airport' ? Plane : Car;

  return (
    <button
      onClick={() => switchService(other)}
      aria-label={`Switch to ${SERVICE_LABEL[other]}`}
      title={`Switch to ${SERVICE_LABEL[other]}`}
      // cream-400, not cream-300, and for the reason spelled out on the nav pill and
      // the Sign Out button below: in DARK mode `--canvas-deep` (cream-300) and
      // `--surface` are the same colour, so a cream-300 fill on this panel has no
      // visible edge at all. Hover goes to a saffron tint rather than a fifth grey.
      className={compact
        ? 'tap-target p-2 text-coffee-500 hover:text-saffron btn-feedback'
        : 'w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-cream-400 text-coffee text-sm font-bold hover:bg-saffron/15 transition-colors min-h-11'}
    >
      <Icon size={compact ? 20 : 16} aria-hidden="true" />
      {!compact && <span className="truncate">{SERVICE_LABEL[other]}</span>}
      {!compact && <Repeat size={14} className="ml-auto shrink-0 text-coffee-500" aria-hidden="true" />}
    </button>
  );
};

// No props. It declared `userName` and `role` and destructured neither, so both were
// dead weight that read as though the header rendered them.
const MobileHeader: React.FC = () => {
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
          <h1 className="font-header font-bold text-base text-coffee truncate">Bhulka Gaadi</h1>
        </div>
        <div className="flex items-center gap-2">
          <ServiceSwitch compact />
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
  const { service } = useService();

  const navItems = getNavItems(role, service);

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
            <h1 className="font-header font-bold text-coffee leading-none">Bhulka Gaadi</h1>
            <p className="text-[10px] text-gold-700 font-bold uppercase tracking-widest mt-1">
              {SERVICE_LABEL[service]}
            </p>
          </div>
        )}
      </div>

      {/* Role Switcher */}
      {!isSidebarCollapsed && (
        <div className="px-6 pb-4 space-y-2">
          <RoleSwitcher />
          <ServiceSwitch />
        </div>
      )}
      {isSidebarCollapsed && (
        <div className="px-3 pb-4 flex justify-center">
          <ServiceSwitch compact />
        </div>
      )}

      {/* Nav Links */}
      <nav className="flex-1 px-3 py-4 space-y-2">
        {navItems.map((item) => {
          const isActive = currentTab === item.id;
          const Icon = item.icon;
          return (
            <React.Fragment key={item.id}>
              {/* Everyday destinations end here. What follows edits live records
                  directly, so it gets visual distance rather than adjacency. */}
              {item.separated && (
                <hr className="border-0 border-t border-hairline/10 !mt-4 mb-2 mx-1" aria-hidden="true" />
              )}
            <button
              onClick={() => setCurrentTab(item.id)}
              title={isSidebarCollapsed ? item.label : undefined}
              // `cream-400`, not `cream-300`. In DARK mode `--canvas-deep`
              // (cream-300) and `--surface` are the SAME colour, 39 34 29, so the
              // selected pill had no fill at all against this panel — the only
              // cues left were a hairline border and the orange text, and hovering
              // an UNselected item (cream-200) looked more selected than the
              // selected one. `cream-400` is `--sunken`, which differs from
              // `--surface` in both themes. See tests/quality/theme-tokens.test.ts.
              className={`w-full flex items-center gap-4 p-3 rounded-2xl transition-all group relative btn-feedback ${isActive
                ? 'bg-cream-400 text-saffron shadow-sm border border-hairline/10'
                // `border border-transparent`, not "no border": with transition-all
                // a border that appears only when selected animates its WIDTH from
                // 0 to 1px on every click. Holding the width constant removes the
                // animation entirely — and with it the 1px content nudge, since
                // box-sizing is border-box so the icon and label shifted inward
                // each time you changed tab.
                : 'border border-transparent text-coffee-500 hover:bg-cream-200 hover:text-coffee'
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
            </React.Fragment>
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
            {/* Renders nothing where the browser cannot install. */}
            <InstallAppButton variant="sidebar" />
            <button
              onClick={logout}
              // cream-400 for the same reason as the nav pill above: cream-300 is
              // indistinguishable from this panel in dark mode.
              className="w-full flex items-center justify-center gap-2 py-3 px-4 bg-cream-400 hover:bg-[rgb(var(--danger-bg))] hover:text-[rgb(var(--danger-text))] text-coffee-700 rounded-xl text-xs font-bold transition-all group btn-feedback"
            >
              <LogOut size={16} className="group-hover:rotate-12 transition-transform" />
              Sign Out
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <InstallAppButton variant="sidebar" collapsed />
            <button
              onClick={logout}
              title="Logout"
              className="w-full flex justify-center p-3 text-coffee-500 hover:text-[rgb(var(--danger-text))] transition-colors btn-feedback"
            >
              <LogOut size={22} />
            </button>
          </div>
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

/**
 * One dock button. Shared by the visible row and the overflow drawer so the two
 * cannot drift into looking like different controls.
 */
const DockButton: React.FC<{
  item: NavItem;
  isActive: boolean;
  onClick: () => void;
  heightClass?: string;
  showActiveBar?: boolean;
}> = ({ item, isActive, onClick, heightClass = 'h-full', showActiveBar = true }) => {
  const Icon = item.icon;
  return (
    <button
      onClick={onClick}
      className={`relative flex flex-col items-center justify-center ${heightClass} w-full transition-all btn-feedback ${isActive ? 'text-saffron-800' : 'text-coffee-500'
        }`}
    >
      {/* cream-400: .clay-bottom-nav is a --surface -> --surface-mid
          gradient, so a cream-300 chip vanished here in dark mode exactly
          as it did in the sidebar. */}
      <div className={`p-1 rounded-xl transition-all ${isActive ? 'bg-cream-400' : ''}`}>
        <Icon className={`w-6 h-6 ${isActive ? 'stroke-[2.5px]' : 'stroke-2'}`} />
      </div>
      <span className="text-[10px] mt-1 font-bold uppercase tracking-tighter truncate max-w-full px-0.5">
        {item.label}
      </span>
      {isActive && showActiveBar && (
        <div className="absolute top-0 w-1/2 max-w-[40px] h-1 bg-saffron-800 rounded-b-md shadow-[0_2px_10px_rgba(184,67,24,0.4)] animate-in slide-in-from-top-1" />
      )}
    </button>
  );
};

/** Past this many pixels of vertical travel, a touch was a swipe and not a tap. */
const SWIPE_THRESHOLD = 24;

/**
 * The pull handle. The hint for the gesture, and nothing more.
 *
 * DELIBERATELY NOT A CONTROL, decided by the owner on 2026-08-18 after the
 * trade-off was put to them. What it costs, recorded so nobody "fixes" it by
 * accident and nobody rediscovers it as a bug:
 *
 *   On a phone this dock is the only navigation there is — the sidebar is
 *   desktop-only — so a swipe is now the ONLY way to reach Reports, Profile and
 *   Records. Anyone who cannot make one (keyboard, switch access, VoiceOver)
 *   cannot reach those three destinations on a phone at all.
 *
 * Restoring a control is a small change: give this a wrapping `<button>` with
 * `onClick`, `aria-expanded` and an `aria-label` of "More destinations", which
 * is what it had before this commit.
 *
 * In the nav it sits inside the existing 8px of top padding, so it adds NO
 * height — `--bottom-nav-h` is what every other element clears by.
 */
const GrabHandle: React.FC<{
  overflowIsActive: boolean;
  className?: string;
}> = ({ overflowIsActive, className = '' }) => (
  <div className={`flex items-center justify-center ${className}`} aria-hidden="true">
    {/* Saffron while a hidden destination is the current one. This bar is the
        only thing left that can say so, and without it the dock reads as
        "nothing selected" whenever a manager sits on Records. */}
    <span className={`h-1 w-9 rounded-full transition-colors ${overflowIsActive ? 'bg-saffron' : 'bg-hairline/25'}`} />
  </div>
);

/**
 * The mobile dock.
 *
 * Seven destinations across a 390px phone gave each one ~47px — under a
 * comfortable thumb target, and the reason the labels are `text-[10px]` and
 * still only just fit. Four destinations plus a More control gives ~78px each,
 * the same five-slot budget iOS uses for a tab bar.
 *
 * The overflow opens UPWARD as a drawer instead of making the dock taller.
 * `--bottom-nav-h` is a static token and `<main>` above reserves exactly that
 * much bottom padding, so a dock that genuinely grew would hide the last row of
 * content behind itself and the page would jump on every open.
 *
 * Only the manager has more than five destinations. Drivers and riders have
 * three, so `primary` is unset for them and they get NO More control — one that
 * opened an empty drawer would be the dead button this repo keeps deleting.
 *
 * A side effect worth keeping: Records edits live names, phone numbers and home
 * addresses with no undo. On desktop it sits behind a divider for that reason;
 * here it now sits behind a deliberate tap instead of next to the button a
 * manager hits every Friday.
 */
const BottomNav: React.FC<{ role: UserRole }> = ({ role }) => {
  const { currentTab, setCurrentTab } = useNavigation();
  const { service } = useService();
  const navItems = getNavItems(role, service);
  const [expanded, setExpanded] = useState(false);

  const primary = navItems.filter(item => item.primary);
  const overflow = navItems.filter(item => !item.primary);
  // BOTH halves must be non-empty. A role that marks nothing shows its whole
  // list exactly as before, and a role that marks everything gets no drawer.
  const hasOverflow = primary.length > 0 && overflow.length > 0;
  const docked = hasOverflow ? primary : navItems;

  // Whether the current tab is one of the hidden ones. Without this the dock
  // would show nothing selected while a manager sits on Records, and they would
  // lose their place every time they glanced down.
  const overflowIsActive = overflow.some(item => item.id === currentTab);

  useEffect(() => {
    if (!expanded) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setExpanded(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded]);

  const choose = (id: TabView) => {
    setCurrentTab(id);
    setExpanded(false);
  };

  // ── Swipe up to open, down to close ──────────────────────────────────────
  //
  // An ADDITION to the More button, never a replacement: a gesture with no
  // visible control is undiscoverable and unreachable by keyboard, so the
  // button stays and does the same job.
  const swipeStartY = useRef<number | null>(null);
  const swipeOrigin = useRef<Node | null>(null);
  const swiped = useRef(false);

  const onTouchStart = (event: React.TouchEvent) => {
    swipeStartY.current = event.touches[0]?.clientY ?? null;
    swipeOrigin.current = event.target instanceof Node ? event.target : null;
    swiped.current = false;
  };

  const onTouchEnd = (event: React.TouchEvent) => {
    const start = swipeStartY.current;
    swipeStartY.current = null;
    const end = event.changedTouches[0]?.clientY;
    if (start === null || end === undefined) return;

    // A tap drifts a few pixels; anything past the threshold was meant.
    const travelled = end - start;
    if (travelled <= -SWIPE_THRESHOLD) {
      swiped.current = true;
      setExpanded(true);
    } else if (travelled >= SWIPE_THRESHOLD) {
      swiped.current = true;
      setExpanded(false);
    }
  };

  // A swipe that STARTS on a nav button still fires that button's click when
  // the finger lifts — so swiping up from Fleet would open the drawer and
  // navigate to Fleet at the same time. Capture phase runs before the button's
  // own handler, which is the only place this can be stopped.
  //
  // Matched against the element the finger STARTED on, not on a bare "did a
  // swipe just happen" flag. That flag stayed armed after the swipe that opens
  // the drawer, so the very next tap — a destination inside the drawer the
  // swipe had just revealed — was swallowed and the drawer sat there doing
  // nothing. The synthetic click a swipe produces always targets its origin;
  // anything else is a real tap and must go through.
  const onClickCapture = (event: React.MouseEvent) => {
    if (!swiped.current) return;
    const origin = swipeOrigin.current;
    const target = event.target;
    if (!origin || !(target instanceof Node) || !(origin === target || origin.contains(target))) return;
    swiped.current = false;
    event.preventDefault();
    event.stopPropagation();
  };

  const gestures = hasOverflow ? { onTouchStart, onTouchEnd, onClickCapture } : {};

  return (
    <>
      {expanded && (
        <>
          {/* Invisible click-catcher, the same pattern RoleSwitcher uses and
              deliberately NOT a Sheet: a dropdown is not modal, and trapping
              focus inside a three-item nav menu would be wrong. `lg:hidden`
              because the dock itself is hidden there — without it, resizing to
              desktop with the drawer open would leave an invisible sheet over
              the whole app. */}
          <div
            className="fixed inset-0 z-dropdown lg:hidden"
            onClick={() => setExpanded(false)}
            aria-hidden="true"
          />
          <div className="clay-bottom-drawer animate-in slide-in-from-bottom-4" {...gestures}>
            <GrabHandle overflowIsActive={overflowIsActive} className="w-full pb-2" />
            <div className="max-w-md mx-auto grid grid-cols-2 gap-1">
              {overflow.map(item => (
                <DockButton
                  key={item.id}
                  item={item}
                  isActive={currentTab === item.id}
                  onClick={() => choose(item.id)}
                  heightClass="py-2"
                  showActiveBar={false}
                />
              ))}
            </div>
          </div>
        </>
      )}

      {/* `is-expanded` drops the rounded top, the cast shadow and the inset
          highlight while the drawer is up — see claymorphism.css. Without it the
          nav's own corners cut two notches into the drawer and its shadow drew a
          line across the join, so the two read as stacked cards. */}
      <nav className={`clay-bottom-nav${expanded ? ' is-expanded' : ''}`} {...gestures}>
        {/* Positioned absolutely inside the nav's existing 8px of top padding,
            so it adds NO height. --bottom-nav-h is what every other element
            clears by, and growing the nav for a decoration would put the two
            out of step. Hidden while open, where the drawer carries it. */}
        {hasOverflow && !expanded && (
          <GrabHandle overflowIsActive={overflowIsActive} className="absolute inset-x-0 top-0 h-2" />
        )}
        <div className="max-w-md mx-auto flex justify-around items-center h-16 gap-0.5">
          {docked.map(item => (
            <DockButton
              key={item.id}
              item={item}
              isActive={currentTab === item.id}
              onClick={() => choose(item.id)}
            />
          ))}

        </div>
      </nav>
    </>
  );
};

interface NavItem {
  id: TabView;
  label: string;
  icon: LucideIcon;
  /**
   * Draw a divider above this item in the sidebar. Marks the end of the
   * everyday destinations, so the advanced one below does not read as a peer.
   */
  separated?: boolean;
  /**
   * Keep this one in the collapsed mobile dock. Everything unmarked moves into
   * the More drawer.
   *
   * Only set for roles with more than five destinations — see BottomNav. The
   * SIDEBAR ignores it entirely and still shows all seven, because a desktop
   * rail has the room a phone does not.
   */
  primary?: boolean;
}

/**
 * The destinations for a role WITHIN a service.
 *
 * `service` defaults to 'sabha' so every existing caller and every existing test —
 * tests/components/bottomNavOverflow.test.tsx and managerNavigation.test.tsx both pin
 * this list — exercises exactly the code it did before.
 *
 * The airport lists are shorter on purpose. A Bhulku has one screen there (ask, then
 * watch), and a Sarthi has two. Padding them out to match the sabha side would mean
 * nav items pointing at screens that do not exist, which is the dead control this
 * codebase keeps removing.
 */
export const getNavItems = (role: UserRole, service: Service = 'sabha'): NavItem[] => {
  /**
   * Airport Seva is TWO surfaces, and which one you get depends on why you are here.
   *
   * A TRAVELLER is here because they have not landed yet: one screen, their own
   * pickup. A MANAGER is here because they switched, and what they came for is the
   * board — they are the only role holding both services, so for them the airport
   * service is where the airport work lives.
   *
   * The manager's first version of this got the traveller's screen, which was wrong
   * twice: a live form that would file a real pickup request in their own name, and
   * an "I am in the USA now" button that did nothing because their `isArriving` was
   * already false. See src/constants/service.ts for the whole note.
   *
   * Kept in step with `tabBelongsTo` by tests/quality/nav-tab-parity.test.ts.
   */
  if (service === 'airport') {
    if (role === 'manager') {
      return [
        { id: 'arrivals', label: 'Arrivals', icon: CalendarDays },
        { id: 'profile', label: 'Profile', icon: UserIcon },
      ];
    }
    return [
      { id: 'airport-request', label: 'My pickup', icon: Ticket },
      { id: 'profile', label: 'Profile', icon: UserIcon },
    ];
  }

  if (role === 'driver') {
    // Four, so still inside the five-slot dock with no overflow drawer.
    return [
      { id: 'home', label: 'Dashboard', icon: Home },
      { id: 'arrivals', label: 'Arrivals', icon: CalendarDays },
      { id: 'history', label: 'History', icon: History },
      { id: 'profile', label: 'Profile', icon: UserIcon },
    ];
  }
  if (role === 'manager') {
    // Seven destinations, replacing three nav systems on one screen: this bar,
    // a segmented control, and four unlabelled toolbar icons — among them a
    // map-pin that meant "settings" and a car that meant "fleet".
    //
    // `Fleet` and `Records` were sections inside Setup's accordion. Fleet earns a
    // place here because it is touched most weeks. Records is LAST and behind a
    // divider on purpose: it edits live documents holding riders' names, phone
    // numbers and home addresses, with no undo, so it must not sit next to the
    // button a manager hits every Friday.
    //
    // Labelled `Records`, not `Raw records`: at 375px the bottom nav gives each
    // item ~47px, and `RAW RECORDS` at text-[10px] uppercase overflows that and
    // truncates. `Fleet` and `Records` both fit.
    return [
      { id: 'home', label: 'Dispatch', icon: LayoutDashboard, primary: true },
      { id: 'people', label: 'People', icon: UserCheck, primary: true },
      { id: 'history', label: 'Reports', icon: History },
      { id: 'fleet', label: 'Fleet', icon: Car, primary: true },
      { id: 'setup', label: 'Setup', icon: Settings, primary: true },
      { id: 'profile', label: 'Profile', icon: UserIcon },
      { id: 'notices', label: 'Notices', icon: Megaphone },
      // NO `arrivals` here. It used to be the ninth destination, in the swipe-up
      // drawer. It moved to Airport Seva, which is the service a manager switches to
      // and the only one that held nothing useful for them before. A Sarthi still
      // reaches the board from sabha, because a Sarthi has no switch.
      { id: 'records', label: 'Records', icon: Database, separated: true },
    ];
  }
  return [
    { id: 'home', label: 'Home', icon: Home },
    { id: 'rides', label: 'My Rides', icon: Car },
    { id: 'profile', label: 'Profile', icon: UserIcon },
  ];
};