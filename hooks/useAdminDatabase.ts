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
import { adminDeleteUserViaCloud } from '../src/utils/cloudFunctions';
import { geocodeAddressInBrowser } from './useGooglePlaces';
import { writeAuditLog } from '../src/utils/audit';
import { FOUNDING_CITY_ID, FOUNDING_LOCATION_ID } from '../src/constants/tenancy';

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
      // Annotated, because spreading a `Record<string, any>` into an object
      // literal loses the index signature — TypeScript inferred plain
      // `{ updatedAt: string }`, so the geocode fields assigned below did not
      // compile. Three of the standing typecheck errors were this one line.
      const updates: Record<string, any> = { ...data, updatedAt: new Date().toISOString() };

      // Geocode in the BROWSER, not through the old cloud callable — that one
      // returned 500 for every call, because the key in functions/.env is
      // referer-restricted and a server sends no referer. See
      // geocodeAddressInBrowser for the full story.
      //
      // Note what happens on a miss: the address is still saved, WITHOUT
      // coordinates. That was the previous behaviour too and it is a real gap —
      // a rider with no pickupLat cannot be dispatched — but it is the manager's
      // own hand-edit of somebody else's record, and refusing the whole save
      // because a geocode failed would be worse. The Waiting queue is where an
      // uncoordinated rider becomes visible.
      if (data.address && typeof data.address === 'string' && data.address.trim().length > 5) {
        try {
          const geo = await geocodeAddressInBrowser(data.address.trim());
          if (geo) {
            updates.pickupLat = geo.latitude;
            updates.pickupLng = geo.longitude;
            updates.location = {
              latitude: geo.latitude,
              longitude: geo.longitude,
              formattedAddress: geo.formattedAddress || data.address.trim(),
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
        // Stamped unless the manager typed one explicitly, so a hand-created
        // record is not the one document the verifier trips over.
        cityId: FOUNDING_CITY_ID,
        locationId: FOUNDING_LOCATION_ID,
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
