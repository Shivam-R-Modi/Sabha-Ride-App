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
import { geocodeAddress } from '../src/utils/cloudFunctions';

export type SupportedCollection = 'users' | 'vehicles' | 'rides' | 'settings' | 'weeklyAttendance' | 'auditLogs';

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

  // Log admin action to /auditLogs
  const logAuditAction = async (
    managerId: string,
    managerName: string,
    action: 'CREATE' | 'UPDATE' | 'DELETE',
    collectionName: string,
    documentId: string,
    details: string
  ) => {
    try {
      await addDoc(collection(db, 'auditLogs'), {
        timestamp: new Date().toISOString(),
        managerId,
        managerName,
        action,
        collection: collectionName,
        documentId,
        details
      });
    } catch (err) {
      console.error('Error recording audit log:', err);
    }
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
        `Deleted record from collection ${targetCol}`
      );
    } catch (err) {
      console.error(`Error deleting document from ${targetCol}:`, err);
      throw err;
    }
  };

  return {
    documents,
    loading,
    error,
    updateAdminDocument,
    createAdminDocument,
    deleteAdminDocument
  };
}
