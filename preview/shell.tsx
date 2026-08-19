// The app shell — sidebar, mobile header, bottom nav. Added because a UI problem
// was reported on "the left panel on any dashboard", and nobody could look at it:
// the sidebar only exists behind a sign-in.
import React from 'react';
import ReactDOM from 'react-dom/client';
import '../theme.css';
import '../index.css';
import '../claymorphism.css';
import '../tailwind.css';
import { ResponsiveLayout } from '../components/Layout';
import { NavigationProvider } from '../contexts/NavigationContext';
import type { UserRole } from '../types';

const Panel: React.FC<{ role: UserRole; label: string }> = ({ role, label }) => (
    <div style={{ marginBottom: 28 }}>
        <p style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '.08em', opacity: .55, padding: '0 8px 6px' }}>{label}</p>
        {/* The sidebar is `fixed`, so each instance needs its own containing block
            to sit inside rather than all stacking on the viewport edge. */}
        <div style={{ position: 'relative', height: 720, overflow: 'hidden', border: '1px solid rgba(0,0,0,.12)', borderRadius: 12, transform: 'translateZ(0)' }}>
            <NavigationProvider>
                <ResponsiveLayout role={role}>
                    <div style={{ padding: 24 }}>
                        <div className="clay-card" style={{ padding: 20 }}>
                            <h2 className="text-xl font-bold text-coffee">Page content</h2>
                            <p className="text-coffee-500 text-sm">Stands in for the dashboard.</p>
                        </div>
                    </div>
                </ResponsiveLayout>
            </NavigationProvider>
        </div>
    </div>
);

ReactDOM.createRoot(document.getElementById('root')!).render(
    <div style={{ padding: 12 }}>
        <Panel role={'manager' as UserRole} label="Manager — sidebar expanded" />
        <Panel role={'driver' as UserRole} label="Sarthi" />
        <Panel role={'student' as UserRole} label="Rider" />
    </div>
);
