import React, { useState } from 'react';
import { X, Save, AlertTriangle, Loader2 } from 'lucide-react';
import { SupportedCollection } from '../../hooks/useAdminDatabase';

interface DocumentEditorModalProps {
  collectionName: SupportedCollection;
  document: Record<string, any> | null; // Null if creating new document
  onClose: () => void;
  onSave: (data: Record<string, any>, docId?: string) => Promise<void>;
}

export const DocumentEditorModal: React.FC<DocumentEditorModalProps> = ({
  collectionName,
  document: initialDoc,
  onClose,
  onSave
}) => {
  const isEditing = !!initialDoc;
  const docId = initialDoc?.id || '';

  // Form state fields
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    if (initialDoc) {
      const { id, ...rest } = initialDoc;
      return rest;
    }

    // Default template fields based on collection
    if (collectionName === 'users') {
      return {
        name: '',
        email: '',
        phone: '',
        role: 'student',
        registeredRole: 'student',
        activeRole: 'student',
        accountStatus: 'approved',
        address: ''
      };
    }
    if (collectionName === 'vehicles') {
      return {
        name: '',
        color: '',
        licensePlate: '',
        capacity: 4,
        status: 'available',
        assignedDriverId: null,
        assignedDriverName: null
      };
    }
    if (collectionName === 'settings') {
      return {
        // Was prefilled with 'sabha2024' — one of the codes hardcoded in the
        // old client-side check. Prefilling a live access code into an editor
        // both leaks it and invites saving it back as the real one.
        code: '',
        address: '11 Maywood St, Boston, MA 02119'
      };
    }
    return {};
  });

  const [customId, setCustomId] = useState(docId);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFieldChange = (key: string, value: any) => {
    setFormData((prev) => ({
      ...prev,
      [key]: value
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      await onSave(formData, isEditing ? docId : (customId.trim() || undefined));
      onClose();
    } catch (err: any) {
      console.error('Error saving document:', err);
      setError(err.message || 'Failed to save document.');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center p-4 z-modal animate-in fade-in duration-200">
      <div className="clay-card max-w-xl w-full bg-surface rounded-3xl p-6 shadow-2xl border border-hairline/10 max-h-[90vh] overflow-y-auto space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-hairline/10 pb-4">
          <div>
            <h3 className="text-xl font-bold text-coffee font-header">
              {isEditing ? `Edit Record: ${docId}` : `Add New Record to ${collectionName}`}
            </h3>
            <p className="text-xs text-coffee-500">Collection: <span className="font-mono text-saffron-800 font-bold">{collectionName}</span></p>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-coffee-500 hover:text-coffee rounded-full hover:bg-cream-300 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {error && (
          <div className="bg-[rgb(var(--danger-bg))] border border-[rgb(var(--danger))]/40 rounded-xl p-3 flex items-center gap-2 text-[rgb(var(--danger-text))] text-xs">
            <AlertTriangle size={16} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {!isEditing && (
            <div>
              <label className="block text-xs font-bold text-coffee-500 uppercase tracking-wider mb-1">
                Custom Document ID (Optional)
              </label>
              <input
                type="text"
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
                placeholder="Auto-generated if left empty"
                className="w-full px-4 py-2.5 rounded-xl border border-hairline/20 text-sm focus:outline-none focus:ring-2 focus:ring-saffron font-mono"
              />
            </div>
          )}

          {Object.keys(formData).map((key) => {
            const val = formData[key];
            const isReadonlyKey = key === 'createdAt' || key === 'updatedAt';

            // THE ROLE FIELDS ARE READ-ONLY HERE, AND THAT IS THE FIX.
            //
            // These three used to be editable dropdowns, and `roles[]` was a
            // plain text field beside them. A role lives in FOUR fields and
            // different readers read different ones — `roles[]` is what the
            // driver picker queries, `registeredRole` what the approval queues
            // query — so changing one at a time produced somebody who was a
            // Sarthi to firestore.rules and invisible to the driver picker, with
            // no field that settled which was true. Nothing here could have
            // prevented it: a form that edits arbitrary fields cannot know that
            // four of them have to move together.
            //
            // firestore.rules now refuses all four from any browser
            // (touchesRoleFields), so leaving these editable would be a control
            // that silently failed — the exact thing this repo keeps deleting.
            // Shown rather than hidden, because a manager needs to SEE the role on
            // a record they are editing; they just change it in the place that can
            // do it correctly.
            if (key === 'role' || key === 'registeredRole' || key === 'activeRole' || key === 'roles') {
              const shown = Array.isArray(val) ? val.join(', ') : String(val ?? '');
              return (
                <div key={key}>
                  <label className="block text-xs font-bold text-coffee-500 uppercase tracking-wider mb-1">{key}</label>
                  <input
                    type="text"
                    value={shown}
                    readOnly
                    aria-describedby="role-fields-note"
                    className="w-full px-4 py-2.5 rounded-xl border border-hairline/20 text-sm bg-cream-300 text-coffee-500 cursor-not-allowed"
                  />
                  {key === 'role' && (
                    <p id="role-fields-note" className="text-[11px] text-coffee-500 mt-1 leading-snug">
                      Roles are changed by tapping the person&rsquo;s name in the table
                      behind this dialog. That route moves all four role fields
                      together, hands back any car and returns assigned riders to the
                      queue &mdash; none of which editing one field here would do.
                    </p>
                  )}
                </div>
              );
            }

            if (key === 'accountStatus') {
              return (
                <div key={key}>
                  <label className="block text-xs font-bold text-coffee-500 uppercase tracking-wider mb-1">{key}</label>
                  <select
                    value={val || 'approved'}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-hairline/20 text-sm focus:outline-none focus:ring-2 focus:ring-saffron bg-surface"
                  >
                    <option value="approved">Approved</option>
                    <option value="pending">Pending</option>
                    <option value="rejected">Rejected</option>
                  </select>
                </div>
              );
            }

            if (key === 'status' && collectionName === 'vehicles') {
              return (
                <div key={key}>
                  <label className="block text-xs font-bold text-coffee-500 uppercase tracking-wider mb-1">{key}</label>
                  <select
                    value={val || 'available'}
                    onChange={(e) => handleFieldChange(key, e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-hairline/20 text-sm focus:outline-none focus:ring-2 focus:ring-saffron bg-surface"
                  >
                    <option value="available">Available</option>
                    <option value="in_use">In Use</option>
                    <option value="maintenance">Maintenance</option>
                  </select>
                </div>
              );
            }

            if (typeof val === 'number') {
              return (
                <div key={key}>
                  <label className="block text-xs font-bold text-coffee-500 uppercase tracking-wider mb-1">{key}</label>
                  <input
                    type="number"
                    value={val}
                    onChange={(e) => handleFieldChange(key, parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-2.5 rounded-xl border border-hairline/20 text-sm focus:outline-none focus:ring-2 focus:ring-saffron"
                  />
                </div>
              );
            }

            if (typeof val === 'boolean') {
              return (
                <div key={key} className="flex items-center gap-3 pt-1">
                  <input
                    type="checkbox"
                    id={`check_${key}`}
                    checked={!!val}
                    onChange={(e) => handleFieldChange(key, e.target.checked)}
                    className="w-4 h-4 text-saffron-800 rounded focus:ring-saffron"
                  />
                  <label htmlFor={`check_${key}`} className="text-xs font-bold text-coffee-700 capitalize">{key}</label>
                </div>
              );
            }

            // Fallback text input
            return (
              <div key={key}>
                <label className="block text-xs font-bold text-coffee-500 uppercase tracking-wider mb-1">{key}</label>
                <input
                  type="text"
                  value={typeof val === 'object' ? JSON.stringify(val) : (val ?? '')}
                  disabled={isReadonlyKey}
                  onChange={(e) => handleFieldChange(key, e.target.value)}
                  className={`w-full px-4 py-2.5 rounded-xl border border-hairline/20 text-sm focus:outline-none focus:ring-2 focus:ring-saffron ${
                    isReadonlyKey ? 'bg-cream-300 text-coffee-500 cursor-not-allowed' : ''
                  }`}
                />
              </div>
            );
          })}

          <div className="flex items-center justify-end gap-3 pt-4 border-t border-hairline/10">
            <button
              type="button"
              onClick={onClose}
              className="clay-button-secondary text-xs px-4 py-2.5"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSaving}
              // `clay-btn-cta` is undefined — see DatabaseConsole. This is the primary
              // action of the dialog that edits live records, so it must look like one.
              className="clay-btn-primary text-xs px-5 py-2.5 flex items-center gap-2"
            >
              {isSaving ? <Loader2 className="animate-spin" size={16} /> : <Save size={16} />}
              <span>{isSaving ? 'Saving...' : 'Save Document'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
