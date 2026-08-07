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

export const DatabaseConsole: React.FC = () => {
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
      alert(err.message || 'Failed to delete document.');
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
      alert(err.message || 'Failed to bulk delete documents.');
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
      <div className="clay-card bg-gradient-to-r from-orange-500/10 via-amber-500/10 to-orange-600/10 border-orange-200/60 p-6 rounded-3xl flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="p-3.5 bg-saffron text-white rounded-2xl shadow-lg shadow-orange-500/20">
            <Database size={28} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-2xl font-bold text-coffee font-header">Database Management Console</h2>
              <span className="bg-emerald-100 text-emerald-700 text-[10px] font-extrabold uppercase px-2.5 py-0.5 rounded-full border border-emerald-200">
                Live Admin Mode
              </span>
            </div>
            <p className="text-xs text-gray-500 mt-1">
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
      <div className="flex items-center gap-2 overflow-x-auto pb-2 border-b border-gray-100 no-scrollbar">
        {[
          { id: 'users', label: 'Users', icon: Users, count: activeTab === 'users' ? documents.length : null },
          { id: 'vehicles', label: 'Vehicles', icon: Car, count: activeTab === 'vehicles' ? documents.length : null },
          { id: 'rides', label: 'Rides', icon: Navigation, count: activeTab === 'rides' ? documents.length : null },
          { id: 'weeklyAttendance', label: 'Attendance', icon: CheckCircle2, count: activeTab === 'weeklyAttendance' ? documents.length : null },
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
                  : 'bg-white text-gray-500 hover:bg-orange-50 border border-gray-100'
              }`}
            >
              <Icon size={16} className={isActive ? 'text-saffron' : 'text-gray-500'} />
              <span>{tab.label}</span>
              {tab.count !== null && (
                <span className={`text-[10px] px-2 py-0.5 rounded-full ${isActive ? 'bg-white/20 text-white' : 'bg-gray-100 text-gray-600'}`}>
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
            <span className="text-xs text-gray-300">
              Bulk actions ready for collection <strong className="text-white capitalize">{activeTab}</strong>
            </span>
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            <button
              onClick={() => setSelectedDocIds([])}
              className="px-3 py-1.5 rounded-xl text-xs font-medium text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
            >
              Deselect All
            </button>
            <button
              onClick={handleBulkDelete}
              disabled={isBulkDeleting}
              className="bg-red-600 hover:bg-red-600 text-white text-xs font-bold px-4 py-1.5 rounded-xl flex items-center gap-2 transition-colors disabled:opacity-50 shadow-md"
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
          <Search size={18} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-gray-500" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={`Search ${activeTab}...`}
            className="w-full pl-10 pr-4 py-2 rounded-xl border border-gray-200 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>

        <div className="flex items-center gap-3 w-full md:w-auto overflow-x-auto">
          {activeTab === 'users' && (
            <div className="flex items-center gap-1.5 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
              <Filter size={14} className="text-gray-500 ml-1" />
              <span className="text-[10px] font-bold text-gray-500 uppercase">Role:</span>
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

          <div className="flex items-center gap-1.5 bg-gray-50 p-1.5 rounded-xl border border-gray-100">
            <Filter size={14} className="text-gray-500 ml-1" />
            <span className="text-[10px] font-bold text-gray-500 uppercase">Status:</span>
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
          <p className="text-xs font-bold text-gray-500">Loading collection {activeTab}...</p>
        </div>
      ) : error ? (
        <div className="clay-card py-12 bg-red-50/50 border-red-100 flex flex-col items-center justify-center text-center p-6 space-y-2">
          <ShieldAlert className="text-red-600" size={32} />
          <p className="text-sm font-bold text-red-600">{error}</p>
          <p className="text-xs text-gray-500">Ensure your account has approved manager credentials in Firestore.</p>
        </div>
      ) : filteredDocuments.length === 0 ? (
        <div className="clay-card py-16 text-center space-y-2">
          <Database className="mx-auto text-gray-300" size={36} />
          <p className="text-sm font-bold text-coffee">No records found in {activeTab}</p>
          <p className="text-xs text-gray-500">Try clearing filters or search keywords.</p>
        </div>
      ) : (
        <div className="clay-card overflow-hidden p-0 rounded-3xl border border-orange-100 shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-orange-50/60 border-b border-orange-100 text-[11px] font-bold text-coffee uppercase tracking-wider">
                  {activeTab !== 'auditLogs' && (
                    <th className="py-3.5 px-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={allSelected}
                        onChange={toggleSelectAll}
                        className="w-4 h-4 text-orange-600 rounded focus:ring-orange-400 cursor-pointer accent-saffron"
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
              <tbody className="divide-y divide-gray-100 text-xs text-coffee">
                {filteredDocuments.map((docItem) => (
                  <tr key={docItem.id} className={`hover:bg-orange-50/30 transition-colors ${selectedDocIds.includes(docItem.id) ? 'bg-orange-50/60' : ''}`}>
                    {activeTab !== 'auditLogs' && (
                      <td className="py-3 px-3 text-center">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.includes(docItem.id)}
                          onChange={() => toggleSelectDoc(docItem.id)}
                          className="w-4 h-4 text-orange-600 rounded focus:ring-orange-400 cursor-pointer accent-saffron"
                        />
                      </td>
                    )}

                    {/* USERS FIELDS */}
                    {activeTab === 'users' && (
                      <>
                        <td className="py-3 px-4">
                          <p className="font-bold">{docItem.name || 'Unnamed'}</p>
                          <p className="text-[10px] text-gray-500">{docItem.email || docItem.phone || 'No contact'}</p>
                        </td>
                        <td className="py-3 px-4 capitalize font-medium">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            docItem.role === 'manager' ? 'bg-purple-100 text-purple-700' :
                            docItem.role === 'driver' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {docItem.role || 'student'}
                          </span>
                        </td>
                        <td className="py-3 px-4 capitalize">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            docItem.accountStatus === 'approved' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {docItem.accountStatus || 'approved'}
                          </span>
                        </td>
                        <td className="py-3 px-4 max-w-xs truncate text-[11px] text-gray-500">
                          {docItem.address || docItem.location?.formattedAddress || 'No address'}
                        </td>
                      </>
                    )}

                    {/* VEHICLES FIELDS */}
                    {activeTab === 'vehicles' && (
                      <>
                        <td className="py-3 px-4 font-bold">{docItem.name}</td>
                        <td className="py-3 px-4 text-gray-500 font-mono text-[11px]">
                          {docItem.licensePlate || docItem.plateNumber} ({docItem.color})
                        </td>
                        <td className="py-3 px-4 font-bold">{docItem.capacity} seats</td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            docItem.status === 'available' ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'
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
                          <p className="text-[10px] text-gray-500">{docItem.timeSlot || '6:00 PM'}</p>
                        </td>
                        <td className="py-3 px-4">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            docItem.status === 'completed' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
                          }`}>
                            {docItem.status || 'requested'}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-gray-600">{docItem.driverName || 'Unassigned'}</td>
                        <td className="py-3 px-4 text-gray-500">
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
                        <td className="py-3 px-4 font-mono text-[11px] text-gray-600 max-w-sm truncate">
                          {docItem.code ? `Manager Code: ${docItem.code}` : docItem.address ? `Venue: ${docItem.address}` : docItem.rideType ? `Ride Type: ${docItem.rideType}` : JSON.stringify(docItem).slice(0, 80)}
                        </td>
                        <td className="py-3 px-4 text-[11px] text-gray-500">
                          {docItem.updatedAt ? new Date(docItem.updatedAt).toLocaleString() : 'N/A'}
                        </td>
                      </>
                    )}

                    {/* AUDIT LOGS FIELDS */}
                    {activeTab === 'auditLogs' && (
                      <>
                        <td className="py-3 px-4 font-bold">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-extrabold ${
                            docItem.action === 'CREATE' ? 'bg-green-100 text-green-700' :
                            docItem.action === 'UPDATE' ? 'bg-blue-100 text-blue-700' : 'bg-red-100 text-red-700'
                          }`}>
                            {docItem.action}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-bold text-coffee">{docItem.managerName}</td>
                        <td className="py-3 px-4 font-mono text-[11px] text-gray-500">
                          {docItem.collection} / {docItem.documentId?.slice(0, 10)}
                        </td>
                        <td className="py-3 px-4 text-[11px] text-gray-500">
                          {docItem.timestamp ? new Date(docItem.timestamp).toLocaleString() : 'N/A'}
                        </td>
                      </>
                    )}

                    {/* OTHER COLLECTIONS FALLBACK */}
                    {activeTab !== 'users' && activeTab !== 'vehicles' && activeTab !== 'rides' && activeTab !== 'settings' && activeTab !== 'auditLogs' && (
                      <td className="py-3 px-4 font-mono text-[11px] text-gray-600 max-w-md truncate">
                        {JSON.stringify(docItem).slice(0, 100)}...
                      </td>
                    )}

                    {/* ACTIONS */}
                    {activeTab !== 'auditLogs' && (
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-2">
                          <button
                            onClick={() => setSelectedDocForEdit(docItem)}
                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                            title="Edit Record"
                          >
                            <Edit2 size={15} />
                          </button>
                          <button
                            onClick={() => handleDelete(docItem.id)}
                            disabled={deletingId === docItem.id}
                            className="p-1.5 text-red-700 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50"
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
