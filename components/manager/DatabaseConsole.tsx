import React, { useState, useMemo } from 'react';
import {
  Database,
  Search,
  Plus,
  Edit2,
  Trash2,
  ShieldAlert,
  Loader2,
  RefreshCw,
  FileText,
  Users,
  Car,
  Navigation,
  CheckCircle2,
  Clock,
  Filter
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useAdminDatabase, SupportedCollection } from '../../hooks/useAdminDatabase';
import { DocumentEditorModal } from './DocumentEditorModal';
import { useConfirm } from '../shared/useConfirm';
import { normaliseAuditRow } from '../../src/utils/audit';
import { useToast } from '../../contexts/ToastContext';

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
      <div className="clay-card bg-gradient-to-r from-[rgb(var(--cta))]/10 via-gold/10 to-[rgb(var(--cta-dark))]/10 border-hairline/20/60 p-6 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3.5 bg-saffron text-white rounded-2xl shadow-lg shadow-saffron/20">
            <Database size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-coffee font-header">Database Management Console</h2>
              <span className="bg-[rgb(var(--success-bg))] text-[rgb(var(--success-text))] text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border border-[rgb(var(--success))]/40">
                Live Admin Mode
              </span>
            </div>
            <p className="text-xs text-coffee-500 mt-1">
              Direct administrative access to inspect, query, edit, and audit system data collections.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto justify-end">
          <button
            onClick={() => setIsCreatingNew(true)}
            disabled={activeTab === 'auditLogs'}
            className={`clay-btn-cta text-xs px-4 py-2.5 flex items-center gap-2 ${
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
                  ? 'bg-coffee text-white shadow-md scale-105'
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
        <div className="clay-card bg-coffee text-white p-4 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3 shadow-xl animate-in slide-in-from-bottom duration-200">
          <div className="flex items-center gap-3">
            <span className="bg-saffron text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm">
              {selectedDocIds.length} Selected
            </span>
            <span className="text-xs text-coffee-400">
              Bulk actions ready for collection <strong className="text-white capitalize">{activeTab}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => setSelectedDocIds([])}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-coffee-400 hover:text-white hover:bg-surface/10 transition-colors"
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

        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto">
          {activeTab === 'users' && (
            <div className="flex items-center gap-1.5 bg-cream-200 p-1.5 rounded-xl border border-hairline/10">
              <Filter size={14} className="text-coffee-500 ml-1" />
              <span className="text-[10px] font-bold text-coffee-500 uppercase">Role:</span>
              <select
                value={roleFilter}
                onChange={(e) => setRoleFilter(e.target.value)}
                className="bg-transparent text-xs font-bold text-coffee focus:outline-none"
              >
                <option value="all">All Roles</option>
                <option value="manager">Managers</option>
                <option value="driver">Drivers</option>
                <option value="student">Students</option>
              </select>
            </div>
          )}

          <div className="flex items-center gap-1.5 bg-cream-200 p-1.5 rounded-xl border border-hairline/10">
            <Filter size={14} className="text-coffee-500 ml-1" />
            <span className="text-[10px] font-bold text-coffee-500 uppercase">Status:</span>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="bg-transparent text-xs font-bold text-coffee focus:outline-none"
            >
              <option value="all">All Statuses</option>
              <option value="approved">Approved</option>
              <option value="pending">Pending</option>
              <option value="available">Available</option>
              <option value="in_use">In Use</option>
              <option value="offline">Offline</option>
            </select>
          </div>
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
