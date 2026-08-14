/**
 * Reading a vehicle document into the shape the UI uses.
 *
 * THE BUG
 * -------
 * `currentDriverName` was read from a document field of that name. Nothing
 * writes it. Every writer sets `assignedDriverName` — `assignVehicleToDriver` on
 * the client, `writeVehicleState` on the server.
 *
 * So the holder was ALWAYS undefined, and `VehicleList`'s "Assigned to: …" line
 * never rendered once. A manager saw a car marked In Use naming nobody, could
 * not delete it (delete is refused while in use), and could not clear it by
 * editing (the form does not touch status). That is what made an ordinary soft
 * release look like data corruption on 2026-08-14.
 *
 * The line directly above it already worked around the identical mismatch for
 * the ID — `currentDriverId` read from `assignedDriverId` — so half the pair was
 * mapped and half was not.
 *
 * This lives in its own test because the fix was originally inside an onSnapshot
 * callback, where nothing could reach it: reverting the mapping broke no test at
 * all until the mapper was pulled out.
 */

import { describe, it, expect, vi } from 'vitest';

vi.mock('firebase/firestore', () => ({
    collection: vi.fn(), doc: vi.fn(), onSnapshot: vi.fn(), query: vi.fn(), where: vi.fn(),
    getDocs: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), addDoc: vi.fn(), updateDoc: vi.fn(),
    deleteDoc: vi.fn(), serverTimestamp: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
    writeBatch: vi.fn(), arrayUnion: vi.fn(), arrayRemove: vi.fn(), increment: vi.fn(),
    documentId: vi.fn(), Timestamp: { now: vi.fn() },
}));
vi.mock('../../firebase/config', () => ({ db: {}, auth: {} }));

import { toVehicle } from '../../hooks/useVehicles';

/** What assignVehicleToDriver and writeVehicleState actually write. */
const HELD_DOC = {
    name: 'Car3',
    color: 'blue',
    licensePlate: 'vbc-213',
    capacity: 4,
    status: 'in_use',
    assignedDriverId: 'driver_1',
    assignedDriverName: 'Tonny Stark',
    updatedAt: '2026-08-14T19:08:45.774Z',
};

describe('toVehicle — the holder', () => {
    it('reads the name from assignedDriverName, which is the field that is written', () => {
        expect(toVehicle('veh_1', HELD_DOC).currentDriverName).toBe('Tonny Stark');
    });

    it('reads the id from assignedDriverId', () => {
        expect(toVehicle('veh_1', HELD_DOC).currentDriverId).toBe('driver_1');
    });

    it('maps BOTH halves of the pair, not just the id', () => {
        // The original defect in one assertion: the id was mapped and the name
        // was not, so a car could be held by an id with no name to show.
        const v = toVehicle('veh_1', HELD_DOC);
        expect(Boolean(v.currentDriverId)).toBe(Boolean(v.currentDriverName));
    });

    it('still accepts a legacy document using the current* names', () => {
        const v = toVehicle('veh_1', {
            ...HELD_DOC,
            assignedDriverId: undefined,
            assignedDriverName: undefined,
            currentDriverId: 'legacy_driver',
            currentDriverName: 'Legacy Name',
        });

        expect(v.currentDriverId).toBe('legacy_driver');
        expect(v.currentDriverName).toBe('Legacy Name');
    });

    it('prefers the written name when a document somehow carries both', () => {
        const v = toVehicle('veh_1', { ...HELD_DOC, currentDriverName: 'Stale Name' });
        expect(v.currentDriverName).toBe('Tonny Stark');
    });

    it('leaves the holder undefined on a free car', () => {
        const v = toVehicle('veh_2', {
            name: 'Car2', status: 'available', assignedDriverId: null, assignedDriverName: null,
        });

        expect(v.currentDriverId).toBeUndefined();
        expect(v.currentDriverName).toBeUndefined();
    });
});

describe('toVehicle — the rest of the document', () => {
    it('carries the fields the fleet list renders', () => {
        const v = toVehicle('veh_1', HELD_DOC);

        expect(v).toMatchObject({
            id: 'veh_1',
            name: 'Car3',
            color: 'blue',
            licensePlate: 'vbc-213',
            capacity: 4,
            status: 'in_use',
        });
    });

    it('defaults capacity to 4 rather than 0', () => {
        // 0 would mean "minus one passenger seat" everywhere downstream.
        expect(toVehicle('veh_1', { name: 'Car9' }).capacity).toBe(4);
    });

    it('defaults status to available rather than blank', () => {
        expect(toVehicle('veh_1', { name: 'Car9' }).status).toBe('available');
    });

    it('keeps updatedAt, which the idle sweep dates a hold from', () => {
        expect(toVehicle('veh_1', HELD_DOC).updatedAt).toBe('2026-08-14T19:08:45.774Z');
    });
});
