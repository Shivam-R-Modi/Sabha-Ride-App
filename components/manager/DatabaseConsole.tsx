import React, { useState, useMemo } from 'react';
import { Database, Search, Plus, Edit2, Trash2, ShieldAlert, Loader2, FileText, Users, Car, Navigation, Clock, Filter, ChevronDown } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useAdminDatabase, SupportedCollection } from '../../hooks/useAdminDatabase';
import { DocumentEditorModal } from './DocumentEditorModal';
import { useConfirm } from '../shared/useConfirm';
import { normaliseAuditRow } from '../../src/utils/audit';
import { useToast } from '../../contexts/ToastContext';

/**
 * One filter pill.
 *
 * WHAT WAS WRONG WITH THE TWO HAND-ROLLED ONES
 * --------------------------------------------
 * They were a bare `<select>` with `bg-transparent` and no `appearance-none`, so
 * the BROWSER drew its own dropdown arrow: a shape and colour this app does not
 * control, sitting flush against the text because nothing reserved room for it.
 * That is the cramped, uneven look — worse on the Status pill, whose longer label
 * pushed the arrow to the pill's edge.
 *
 * They also each carried their own funnel icon, so a two-filter row showed the
 * same glyph twice, and mixed `gap-1.5` with an `ml-1` on the icon, so the spacing
 * was uneven between them.
 *
 * Still a native `<select>`: it keeps keyboard support, screen-reader semantics and
 * the platform picker on mobile, which a hand-built dropdown would all have to
 * re-earn. `appearance-none` plus a `ChevronDown` gives it our chevron, and
 * `pr-9` reserves the space that was missing. The option list itself follows
 * `color-scheme`, which theme.css sets per theme, so the native menu is already
 * dark in dark mode.
 */
const FilterSelect: React.FC<{
    label: string;
    value: string;
    onChange: (value: string) => void;
    children: React.ReactNode;
}> = ({ label, value, onChange, children }) => (
    <label className="relative flex items-center gap-2 bg-cream-200 pl-3 pr-9 py-2 rounded-xl
                      border border-hairline/10 cursor-pointer shrink-0
                      focus-within:ring-2 focus-within:ring-saffron">
        <span className="text-[10px] font-bold text-coffee-500 uppercase tracking-wide shrink-0">
            {label}
        </span>
        <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            aria-label={label}
            className="appearance-none bg-transparent text-xs font-bold text-coffee
                       focus:outline-none cursor-pointer"
        >
            {children}
        </select>
        <ChevronDown
            size={14}
            aria-hidden="true"
            className="absolute right-3 text-coffee-500 pointer-events-none"
        />
    </label>
);

export const DatabaseConsole: React.FC = () => {
  const toast = useToast();
  const { userProfile, currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<SupportedCollection>('users');
  const [searchTerm, setSearchTerm] = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedDocForEdit, setSelectedDocForEdit] = useState<Record<string, any> | null>(null);
  const [isCreatingNew, setIsCreatingNew] = useState(false);
  const [selectedDocIds, setSelectedDocIds] = useState<string[]>([]);
  const [isBulkDeleting, setIsBulkDeleting] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const { ask, confirmDialog } = useConfirm();

  const { documents, loading, error, updateAdminDocument, createAdminDocument, deleteAdminDocument, deleteMultipleAdminDocuments } =
    useAdminDatabase(activeTab);

  const managerInfo = useMemo(() => ({
    id: currentUser?.uid || 'manager',
    name: userProfile?.name || 'Manager'
  }), [currentUser, userProfile]);

  // Filtered documents
  const filteredDocuments = useMemo(() => {
    return documents.filter((doc) => {
      // Search term matching
      const docString = JSON.stringify(doc).toLowerCase();
      const matchesSearch = !searchTerm.trim() || docString.includes(searchTerm.toLowerCase());

      // Role filter for users
      if (activeTab === 'users' && roleFilter !== 'all') {
        const userRole = doc.role || doc.activeRole || doc.registeredRole;
        if (userRole !== roleFilter) return false;
      }

      // Status filter for users/vehicles/rides
      if (statusFilter !== 'all') {
        const docStatus = doc.accountStatus || doc.status;
        if (docStatus !== statusFilter) return false;
      }

      return matchesSearch;
    });
  }, [documents, searchTerm, roleFilter, statusFilter, activeTab]);

  const allSelected = useMemo(() => {
    if (filteredDocuments.length === 0) return false;
    return filteredDocuments.every((doc) => selectedDocIds.includes(doc.id));
  }, [filteredDocuments, selectedDocIds]);

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedDocIds([]);
    } else {
      setSelectedDocIds(filteredDocuments.map((doc) => doc.id));
    }
  };

  const toggleSelectDoc = (docId: string) => {
    setSelectedDocIds((prev) =>
      prev.includes(docId) ? prev.filter((id) => id !== docId) : [...prev, docId]
    );
  };

  const handleDelete = async (docId: string) => {
    if (!await ask({
      title: 'Delete permanently?',
      message: `Record ${docId} in ${activeTab} will be deleted. This cannot be undone.`,
      destructive: true,
    })) {
      return;
    }
    setDeletingId(docId);
    try {
      await deleteAdminDocument(activeTab, docId, managerInfo);
      setSelectedDocIds((prev) => prev.filter((id) => id !== docId));
    } catch (err: any) {
      toast.error(err.message || 'Could not delete that document.');
    } finally {
      setDeletingId(null);
    }
  };

  const handleBulkDelete = async () => {
    if (selectedDocIds.length === 0) return;
    if (!await ask({
      title: 'Delete permanently?',
      message: `${selectedDocIds.length} records in ${activeTab} will be deleted. This cannot be undone.`,
      destructive: true,
    })) {
      return;
    }
    setIsBulkDeleting(true);
    try {
      await deleteMultipleAdminDocuments(activeTab, selectedDocIds, managerInfo);
      setSelectedDocIds([]);
    } catch (err: any) {
      toast.error(err.message || 'Could not delete those documents.');
    } finally {
      setIsBulkDeleting(false);
    }
  };

  const handleSaveDocument = async (formData: Record<string, any>, customDocId?: string) => {
    if (selectedDocForEdit) {
      await updateAdminDocument(activeTab, selectedDocForEdit.id, formData, managerInfo);
    } else {
      await createAdminDocument(activeTab, customDocId, formData, managerInfo);
    }
    setSelectedDocForEdit(null);
    setIsCreatingNew(false);
  };

  return (
    <div className="space-y-6 pb-12 animate-in fade-in duration-300">
      {/* Header Banner */}
      {/* The via stop and the shadow were stock amber/orange — fixed light-mode
          colours in a gradient whose other two stops were already tokens. The
          gold and saffron ramps are the same hues and follow the theme.

          Not writing those class names out: Tailwind scans this file as plain
          TEXT, comments included, so naming a utility re-emits it. */}
      {/* `border-hairline/20/60` was two opacity modifiers — no CSS, no border.
          Now `/20`.

          The TITLE and SUBTITLE that used to sit here are gone. This console became
          its own page on 2026-08-18 (components/manager/ManagerRecords.tsx), which
          supplies the `<h1>` and the danger warning — so the banner was repeating
          the page heading directly beneath it. What is left is what only this
          component can say: the mode badge and the action. */}
      <div className="clay-card bg-gradient-to-r from-[rgb(var(--cta))]/10 via-gold/10 to-[rgb(var(--cta-dark))]/10 border border-hairline/20 p-4 rounded-3xl flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="p-2.5 bg-saffron text-[rgb(var(--text-on-accent))] rounded-2xl shadow-lg shadow-saffron/20 shrink-0">
            <Database size={20} />
          </div>
          {/* "Direct", not "Live", database access — the badge beside it already
              says LIVE ADMIN MODE, and two "Live"s in four words reads as a stutter.
              Same word the old subtitle used ("Direct administrative access to…").

              An h2, because ManagerRecords owns the page's h1. This names the tool;
              it does not repeat the page title, which is what the old two-line
              banner was doing. */}
          <h2 className="font-header font-bold text-coffee text-sm sm:text-base truncate">
            Direct database access
          </h2>
          <span className="bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))] text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border border-[rgb(var(--success))]/40 shrink-0">
            Live Admin Mode
          </span>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={() => setIsCreatingNew(true)}
            disabled={activeTab === 'auditLogs'}
            // `clay-btn-cta` does not exist in any stylesheet — only
            // `clay-btn-cta-large` does — so this was unstyled text with a plus
            // icon, not a button. `clay-btn-primary` is the defined CTA fill.
            className={`clay-btn-primary text-xs px-4 py-2.5 flex items-center gap-2 ${
              activeTab === 'auditLogs' ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            <Plus size={16} />
            <span>Add Record</span>
          </button>
        </div>
      </div>

      {/* Collection Selector Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-hairline/10 no-scrollbar">
        {[
          { id: 'users', label: 'Users', icon: Users, count: activeTab === 'users' ? documents.length : null },
          { id: 'vehicles', label: 'Vehicles', icon: Car, count: activeTab === 'vehicles' ? documents.length : null },
          { id: 'rides', label: 'Rides', icon: Navigation, count: activeTab === 'rides' ? documents.length : null },
          // The Attendance tab was here. Removed with 'weeklyAttendance' from
          // SupportedCollection: responses live in a subcollection this console
          // cannot see, so its delete button would have orphaned them.
          { id: 'settings', label: 'Settings', icon: FileText, count: activeTab === 'settings' ? documents.length : null },
          { id: 'auditLogs', label: 'Audit Logs', icon: Clock, count: activeTab === 'auditLogs' ? documents.length : null }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => {
                setActiveTab(tab.id as SupportedCollection);
                setSearchTerm('');
                setRoleFilter('all');
                setStatusFilter('all');
                setSelectedDocIds([]);
              }}
              className={`flex items-center gap-2 px-4 py-2.5 rounded-2xl text-xs font-bold transition-all whitespace-nowrap ${
                isActive
                  ? 'bg-coffee text-cream shadow-md scale-105'
                  : 'bg-surface text-coffee-500 hover:bg-cream-300 border border-hairline/10'
              }`}
            >
              <Icon size={16} className={isActive ? 'text-saffron' : 'text-coffee-500'} />
              <span>{tab.label}</span>
              {tab.count !== null && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${isActive ? 'bg-surface/20 text-white' : 'bg-cream-300 text-coffee-700'}`}>
                  {tab.count}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Floating Bulk Action Bar */}
      {selectedDocIds.length > 0 && activeTab !== 'auditLogs' && (
        <div className="clay-card bg-coffee text-cream p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xl animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center gap-3">
            <span className="bg-saffron text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm">
              {selectedDocIds.length} Selected
            </span>
            <span className="text-xs text-cream/70">
              Bulk actions ready for collection <strong className="text-cream capitalize">{activeTab}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => setSelectedDocIds([])}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-cream/70 hover:text-cream hover:bg-surface/10 transition-colors"
            >
              Deselect All
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="bg-[rgb(var(--danger-fill))] hover:opacity-90 text-[rgb(var(--text-on-accent))] text-xs font-bold px-4 py-1.5 rounded-xl flex items-center gap-2 transition-colors disabled:opacity-50 shadow-md"
            >
              {isBulkDeleting ? <Loader2 className="animate-spin" size={14} /> : <Trash2 size={14} />}
              <span>{isBulkDeleting ? 'Deleting...' : `Delete Selected (${selectedDocIds.length})`}</span>
            </button>
          </div>
        </div>
      )}

      {/* Search & Filtering Bar */}
      <div className="clay-card p-4 rounded-2xl flex flex-col md:flex-row items-center justify-between gap-3">
        <div className="relative w-full md:w-80">
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-coffee-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Search ${activeTab}...`}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-hairline/20 text-xs focus:outline-none focus:ring-2 focus:ring-saffron"
          />
        </div>

        {/* ONE funnel for the group, not one per pill.
            `no-scrollbar`: the global thumb is a 10px saffron gradient, which on a
            short strip like this draws a solid orange bar under the filters. The tab
            row above already had it; this one was missed. The TABLE below keeps its
            scrollbar on purpose — there, scrolling is real. */}
        <div className="flex items-center gap-2 w-full md:w-auto overflow-x-auto no-scrollbar">
          <Filter size={14} aria-hidden="true" className="text-coffee-500 shrink-0" />

          {activeTab === 'users' && (
            <FilterSelect label="Role" value={roleFilter} onChange={setRoleFilter}>
              <option value="all">All roles</option>
              <option value="manager">Managers</option>
              <option value="driver">Drivers</option>
              <option value="student">Students</option>
            </FilterSelect>
          )}

          <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter}>
            <option value="all">All statuses</option>
            <option value="approved">Approved</option>
            <option value="pending">Pending</option>
            <option value="available">Available</option>
            <option value="in_use">In use</option>
            <option value="offline">Offline</option>
          </FilterSelect>
        </div>
      </div>

      {/* Main Data Table View */}
      {loading ? (
        <div className="clay-card py-16 flex flex-col items-center justify-center space-y-3">
          <Loader2 className="animate-spin text-saffron" size={32} />
          <p className="text-xs font-bold text-coffee-500">Loading collection {activeTab}...</p>
        </div>
      ) : error ? (
        <div className="clay-card py-12 bg-[rgb(var(--danger-bg))]/50 border-[rgb(var(--danger))]/25 flex flex-col items-center justify-center text-center p-6 space-y-2">
          <ShieldAlert className="text-[rgb(var(--danger-text))]" size={32} />
          <p className="text-sm font-bold text-[rgb(var(--danger-text))]">{error}</p>
          <p className="text-xs text-coffee-500">Ensure your account has approved manager credentials in Firestore.</p>
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="clay-card py-16 text-center space-y-2">
          <Database className="mx-auto text-coffee-400" size={36} />
          <p className="text-sm font-bold text-coffee">No records found in {activeTab}</p>
          <p className="text-xs text-coffee-500">Try clearing filters or search keywords.</p>
        </div>
      ) : (
        <div className="clay-card overflow-hidden p-0 rounded-3xl border border-hairline/10 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-cream-300/60 border-b border-hairline/10 text-[11px] font-bold text-coffee uppercase tracking-wider">
                  {activeTab !== 'auditLogs' && (
                    <th className="py-3.5 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 text-saffron-800 rounded focus:ring-saffron cursor-pointer accent-saffron"
                        title="Select All"
                      />
                    </th>
                  )}
                  {activeTab === 'users' && (
                    <>
                      <th className="py-3.5 px-4">Name / Contact</th>
                      <th className="py-3.5 px-4">Role</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4">Address</th>
                    </>
                  )}
                  {activeTab === 'vehicles' && (
                    <>
                      <th className="py-3.5 px-4">Vehicle Name</th>
                      <th className="py-3.5 px-4">Plate / Color</th>
                      <th className="py-3.5 px-4">Capacity</th>
                      <th className="py-3.5 px-4">Status</th>
                    </>
                  )}
                  {activeTab === 'rides' && (
                    <>
                      <th className="py-3.5 px-4">Type / Time</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4">Driver</th>
                      <th className="py-3.5 px-4">Student(s)</th>
                    </>
                  )}
                  {activeTab === 'settings' && (
                    <>
                      <th className="py-3.5 px-4">Setting Key / Name</th>
                      <th className="py-3.5 px-4">Value / Content</th>
                      <th className="py-3.5 px-4">Last Updated</th>
                    </>
                  )}
                  {activeTab === 'auditLogs' && (
                    <>
                      <th className="py-3.5 px-4">Action</th>
                      <th className="py-3.5 px-4">Manager</th>
                      <th className="py-3.5 px-4">Target Col / Doc</th>
                      <th className="py-3.5 px-4">Timestamp</th>
                    </>
                  )}
                  {activeTab !== 'users' && activeTab !== 'vehicles' && activeTab !== 'rides' && activeTab !== 'settings' && activeTab !== 'auditLogs' && (
                    <th className="py-3.5 px-4">Record Data</th>
                  )}
                  {activeTab !== 'auditLogs' && <th className="py-3.5 px-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-hairline/10 text-xs text-coffee">
                {filteredDocuments.map((docItem) => (
                  <tr key={docItem.id} className={`hover:bg-cream-300/30 transition-colors ${selectedDocIds.includes(docItem.id) ? 'bg-cream-300/60' : ''}`}>
                    {activeTab !== 'auditLogs' && (
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.includes(docItem.id)}
                          onChange={() => toggleSelectDoc(docItem.id)}
                          className="w-4 h-4 text-saffron-800 rounded focus:ring-saffron cursor-pointer accent-saffron"
                        />
                      </td>
                    )}

                    {/* USERS FIELDS */}
                    {activeTab === 'users' && (
                      <>
                        <td className="py-3 px-4">
                          <p className="font-bold">{docItem.name || 'Unnamed'}</p>
                          <p className="text-[10px] text-coffee-500">{docItem.email || docItem.phone || 'No contact'}</p>
                        </td>
                        <td className="py-3 px-4 capitalize font-medium">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            docItem.role === 'manager' ? 'bg-cream-400 text-coffee' :
                            docItem.role === 'driver' ? 'bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]' : 'bg-[rgb(var(--warning-bg))] text-[rgb(var(--warning-text))]'
                          }`}>
                            {docItem.role || 'student'}
                          </span>
                        </td>
                        <td className="py-3 px-4 capitalize">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            docItem.accountStatus === 'approved' ? 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]' : 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]'
                          }`}>
                            {docItem.accountStatus || 'approved'}
                          </span>
                        </td>
                        <td className="py-3 px-4 max-w-xs truncate text-[11px] text-coffee-500">
                          {docItem.address || docItem.location?.formattedAddress || 'No address'}
                        </td>
                      </>
                    )}

                    {/* VEHICLES FIELDS */}
                    {activeTab === 'vehicles' && (
                      <>
                        <td className="py-3 px-4 font-bold">{docItem.name}</td>
                        <td className="py-3 px-4 text-coffee-500 font-mono text-[11px]">
                          {docItem.licensePlate || docItem.plateNumber} ({docItem.color})
                        </td>
                        <td className="py-3 px-4 font-bold">{docItem.capacity} seats</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            docItem.status === 'available' ? 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]' : 'bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]'
                          }`}>
                            {docItem.status || 'available'}
                          </span>
                        </td>
                      </>
                    )}

                    {/* RIDES FIELDS */}
                    {activeTab === 'rides' && (
                      <>
                        <td className="py-3 px-4">
                          <p className="font-bold">{docItem.rideType || 'home-to-sabha'}</p>
                          <p className="text-[10px] text-coffee-500">{docItem.timeSlot || '6:00 PM'}</p>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            docItem.status === 'completed' ? 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]' : 'bg-[rgb(var(--warning-bg))] text-[rgb(var(--warning-text))]'
                          }`}>
                            {docItem.status || 'requested'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-coffee-700">{docItem.driverName || 'Unassigned'}</td>
                        <td className="py-3 px-4 text-coffee-500">
                          {docItem.students?.length || (docItem.studentName ? 1 : 0)} student(s)
                        </td>
                      </>
                    )}

                    {/* SETTINGS FIELDS */}
                    {activeTab === 'settings' && (
                      <>
                        <td className="py-3 px-4 font-bold text-coffee">
                          {docItem.id || docItem.name || 'System Setting'}
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-coffee-700 max-w-sm truncate">
                          {docItem.code ? `Manager Code: ${docItem.code}` : docItem.address ? `Venue: ${docItem.address}` : docItem.rideType ? `Ride Type: ${docItem.rideType}` : JSON.stringify(docItem).slice(0, 80)}
                        </td>
                        <td className="py-3 px-4 text-[11px] text-coffee-500">
                          {docItem.updatedAt ? new Date(docItem.updatedAt).toLocaleString() : 'N/A'}
                        </td>
                      </>
                    )}

                    {/* AUDIT LOGS FIELDS
                        Read through normaliseAuditRow because three field shapes
                        exist in production and audit history is never rewritten.
                        This used to read `managerName` and `collection` directly,
                        so a sabha deletion — written under different names — would
                        have rendered as blank columns even once the query returned
                        it. */}
                    {activeTab === 'auditLogs' && (() => {
                      const row = normaliseAuditRow(docItem);
                      return (
                        <>
                          <td className="py-3 px-4 font-bold">
                            <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                              row.tone === 'create' ? 'bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))]' :
                              row.tone === 'neutral' ? 'bg-[rgb(var(--info-bg))] text-[rgb(var(--info-text))]' : 'bg-[rgb(var(--danger-bg))] text-[rgb(var(--danger-text))]'
                            }`}>
                              {row.action}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-bold text-coffee">{row.actorName}</td>
                          <td className="py-3 px-4 font-mono text-[11px] text-coffee-500">
                            {row.target}
                            {row.summary && (
                              <span className="block font-sans text-coffee-500 truncate max-w-xs">{row.summary}</span>
                            )}
                          </td>
                          <td className="py-3 px-4 text-[11px] text-coffee-500">
                            {row.timestamp ? new Date(row.timestamp).toLocaleString() : 'N/A'}
                          </td>
                        </>
                      );
                    })()}

                    {/* OTHER COLLECTIONS FALLBACK */}
                    {activeTab !== 'users' && activeTab !== 'vehicles' && activeTab !== 'rides' && activeTab !== 'settings' && activeTab !== 'auditLogs' && (
                      <td className="py-3 px-4 font-mono text-[11px] text-coffee-700 max-w-md truncate">
                        {JSON.stringify(docItem).slice(0, 100)}...
                      </td>
                    )}

                    {/* ACTIONS */}
                    {activeTab !== 'auditLogs' && (
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setSelectedDocForEdit(docItem)}
                            className="p-1.5 text-[rgb(var(--info-text))] hover:bg-[rgb(var(--info-bg))] rounded-lg transition-colors"
                            title="Edit Record"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(docItem.id)}
                            disabled={deletingId === docItem.id}
                            className="p-1.5 text-[rgb(var(--danger-text))] hover:bg-[rgb(var(--danger-bg))] rounded-lg transition-colors disabled:opacity-50"
                            title="Delete Record"
                          >
                            {deletingId === docItem.id ? <Loader2 className="animate-spin" size={15} /> : <Trash2 size={15} />}
                          </button>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Document Editor Modal */}
      {(selectedDocForEdit || isCreatingNew) && (
        <DocumentEditorModal
          collectionName={activeTab}
          document={selectedDocForEdit}
          onClose={() => {
            setSelectedDocForEdit(null);
            setIsCreatingNew(false);
          }}
          onSave={handleSaveDocument}
        />
      )}

      {confirmDialog}
    </div>
  );
};
