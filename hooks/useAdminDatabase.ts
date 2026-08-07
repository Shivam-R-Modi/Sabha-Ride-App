import { useState, useEffect } from 'react';
import { db } from '../firebase/config';
import {
  collection,
  query,
  onSnapshot,
  doc,
  setDoc,
  deleteDoc,
  addDoc,
  orderBy,
  limit
} from 'firebase/firestore';
import { geocodeAddress, adminDeleteUserViaCloud } from '../src/utils/cloudFunctions';
import { writeAuditLog } from '../src/utils/audit';

/**
 * Collections the admin console may browse and edit.
 *
 * `weeklyAttendance` was here and has been removed deliberately. The console
 * lists parent documents only and offers delete and bulk-delete, but attendance
 * responses live in a `responses/*` SUBCOLLECTION — which Firestore does not
 * delete with its parent. Deleting from here would have left every response
 * behind, invisible to the very screen that deleted them. firestore.rules now
 * states the deny explicitly (it was previously an accident of omission), so this
 * would fail rather than half-succeed; removing the tab means a manager is not
 * offered a button that cannot work.
 *
 * Deleting a gathering's attendance is what `deleteSabhaEvent` is for.
 */
export type SupportedCollection = 'users' | 'vehicles' | 'rides' | 'settings' | 'auditLogs';

export function useAdminDatabase(targetCollection: SupportedCollection) {
  const [documents, setDocuments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);

    let q;
    if (targetCollection === 'auditLogs') {
      q = query(collection(db, 'auditLogs'), orderBy('timestamp', 'desc'), limit(100));
    } else {
      q = query(collection(db, targetCollection));
    }

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: any[] = [];
        snapshot.forEach((docSnap) => {
          list.push({ id: docSnap.id, ...docSnap.data() });
        });
        setDocuments(list);
        setLoading(false);
      },
      (err) => {
        console.error(`Error fetching collection ${targetCollection}:`, err);
        setError(`Failed to load ${targetCollection}`);
        setLoading(false);
      }
    );

    return unsubscribe;
  }, [targetCollection]);

  /**
   * Log an admin action to /auditLogs.
   *
   * Was its own inline shape — `{ managerId, managerName, action: 'CREATE' |
   * 'UPDATE' | 'DELETE', collection, documentId, details: string }` — which
   * disagreed with what deleteSabhaEvent wrote. One schema now, in
   * src/utils/audit.ts, so every row appears in the same query.
   */
  const logAuditAction = async (
    managerId: string,
    managerName: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    collectionName: string,
    documentId: string,
    details: string
  ) => {
    const auditAction = action === 'CREATE' ? 'doc.create'
      : action === 'UPDATE' ? 'doc.update'
      : 'doc.delete';

    await writeAuditLog({
      action: auditAction,
      actorUid: managerId,
      actorName: managerName,
      targetCollection: collectionName,
      targetDocumentId: documentId,
      summary: details,
    });
  };

  // Update a document in any collection
  const updateAdminDocument = async (
    targetCol: SupportedCollection,
    docId: string,
    data: Record<string, any>,
    managerInfo: { id: string; name: string }
  ) => {
    try {
      const updates = { ...data, updatedAt: new Date().toISOString() };

      // Geocode address if user or setting address field was updated
      if (data.address && typeof data.address === 'string' && data.address.trim().length > 5) {
        try {
          const geoRes = await geocodeAddress(data.address.trim());
          if (geoRes?.lat && geoRes?.lng) {
            updates.pickupLat = geoRes.lat;
            updates.pickupLng = geoRes.lng;
            updates.location = {
              latitude: geoRes.lat,
              longitude: geoRes.lng,
              formattedAddress: geoRes.formattedAddress || data.address.trim(),
              geocodedAt: new Date().toISOString()
            };
          }
        } catch (geoErr) {
          console.warn('Geocoding warning during admin edit:', geoErr);
        }
      }

      if (targetCol === 'auditLogs') return;

      const docRef = doc(db, targetCol, docId);
      await setDoc(docRef, updates, { merge: true });

      // Also mirror to 'cars' collection if targetCol is 'vehicles'
      if (targetCol === 'vehicles') {
        await setDoc(doc(db, 'cars', docId), updates, { merge: true });
      }

      await logAuditAction(
        managerInfo.id,
        managerInfo.name,
        'UPDATE',
        targetCol,
        docId,
        `Updated fields: ${Object.keys(data).join(', ')}`
      );
    } catch (err) {
      console.error(`Error updating document in ${targetCol}:`, err);
      throw err;
    }
  };

  // Create a document in any collection
  const createAdminDocument = async (
    targetCol: SupportedCollection,
    docId: string | undefined,
    data: Record<string, any>,
    managerInfo: { id: string; name: string }
  ) => {
    try {
      const payload = {
        ...data,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (targetCol === 'auditLogs') return;

      let createdId = docId;
      if (docId) {
        await setDoc(doc(db, targetCol, docId), payload, { merge: true });
      } else {
        const ref = await addDoc(collection(db, targetCol), payload);
        createdId = ref.id;
      }

      if (targetCol === 'vehicles' && createdId) {
        await setDoc(doc(db, 'cars', createdId), payload, { merge: true });
      }

      await logAuditAction(
        managerInfo.id,
        managerInfo.name,
        'CREATE',
        targetCol,
        createdId || 'new',
        `Created document with keys: ${Object.keys(data).join(', ')}`
      );
      return createdId;
    } catch (err) {
      console.error(`Error creating document in ${targetCol}:`, err);
      throw err;
    }
  };

  // Delete a document from any collection
  const deleteAdminDocument = async (
    targetCol: SupportedCollection,
    docId: string,
    managerInfo: { id: string; name: string }
  ) => {
    try {
      if (targetCol === 'auditLogs') return;

      if (targetCol === 'users') {
        try {
          await adminDeleteUserViaCloud(docId);
          return;
        } catch (cloudErr) {
          console.warn('Cloud Function user deletion warning, falling back to direct Firestore delete:', cloudErr);
        }
      }

      await deleteDoc(doc(db, targetCol, docId));

      // The `students/{uid}` and `drivers/{uid}` mirrors used to be swept here.
      // Nothing has written one in a long time, firestore.rules now denies them
      // outright, and adminDeleteUser already clears any legacy row under the
      // Admin SDK. Kept as `.catch(() => {})`, these were two writes that could
      // only ever fail silently.

      if (targetCol === 'vehicles') {
        await deleteDoc(doc(db, 'cars', docId)).catch(() => {});
      }

      await logAuditAction(
        managerInfo.id,
        managerInfo.name,
        'DELETE',
        targetCol,
        docId,
        `Deleted record from collection ${targetCol}`
      );
    } catch (err) {
      console.error(`Error deleting document from ${targetCol}:`, err);
      throw err;
    }
  };

  // Delete multiple documents from any collection in parallel
  const deleteMultipleAdminDocuments = async (
    targetCol: SupportedCollection,
    docIds: string[],
    managerInfo: { id: string; name: string }
  ) => {
    try {
      if (targetCol === 'auditLogs') return;

      if (targetCol === 'users') {
        try {
          await adminDeleteUserViaCloud(docIds);
          return;
        } catch (cloudErr) {
          console.warn('Cloud Function bulk user deletion warning, falling back to direct Firestore delete:', cloudErr);
        }
      }

      await Promise.all(
        docIds.map(async (docId) => {
          await deleteDoc(doc(db, targetCol, docId));
          if (targetCol === 'vehicles') {
            await deleteDoc(doc(db, 'cars', docId)).catch(() => {});
          }
          await logAuditAction(
            managerInfo.id,
            managerInfo.name,
            'DELETE',
            targetCol,
            docId,
            `Bulk deleted record from collection ${targetCol}`
          );
        })
      );
    } catch (err) {
      console.error(`Error bulk deleting documents from ${targetCol}:`, err);
      throw err;
    }
  };

  return {
    documents,
    loading,
    error,
    updateAdminDocument,
    createAdminDocument,
    deleteAdminDocument,
    deleteMultipleAdminDocuments
  };
}
