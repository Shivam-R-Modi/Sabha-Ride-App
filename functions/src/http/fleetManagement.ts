// ============================================
// HTTP FUNCTIONS: Fleet Management
// addCarToFleet and removeCarFromFleet
// ============================================

import * as functions from 'firebase-functions';
import * as admin from 'firebase-admin';
import { Car } from '../types';

/**
 * HTTP Callable: Add a new car to the fleet
 * Input: { model: string, color: string, licensePlate: string, capacity: number }
 * Output: { carId: string }
 */
export const addCarToFleet = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { model, color, licensePlate, capacity } = data;

    // Validate inputs
    if (!model || !color || !licensePlate || !capacity) {
        throw new functions.https.HttpsError('invalid-argument', 'All fields are required');
    }

    if (capacity < 2 || capacity > 10) {
        throw new functions.https.HttpsError('invalid-argument', 'Capacity must be between 2 and 10');
    }

    const db = admin.firestore();

    try {
        // Verify the caller is a manager
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }

        const user = userDoc.data();
        if (!user?.roles?.includes('manager')) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can add cars');
        }

        // Check if license plate already exists
        const existingCar = await db.collection('cars')
            .where('licensePlate', '==', licensePlate)
            .get();

        if (!existingCar.empty) {
            throw new functions.https.HttpsError(
                'already-exists',
                'A car with this license plate already exists'
            );
        }

        // Create new car document
        const carRef = db.collection('cars').doc();
        const car: Omit<Car, 'id'> = {
            model,
            color,
            licensePlate,
            capacity,
            status: 'available',
            assignedDriverId: null
        };

        await carRef.set(car);

        return {
            success: true,
            carId: carRef.id,
            car: {
                id: carRef.id,
                ...car
            }
        };

    } catch (error) {
        console.error('Error adding car:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to add car');
    }
});

/**
 * HTTP Callable: Remove a car from the fleet
 * Input: { carId: string }
 * Output: Success confirmation
 */
export const removeCarFromFleet = functions.https.onCall(async (data, context) => {
    // Verify authentication
    if (!context.auth) {
        throw new functions.https.HttpsError('unauthenticated', 'User must be authenticated');
    }

    const { carId } = data;

    if (!carId) {
        throw new functions.https.HttpsError('invalid-argument', 'carId is required');
    }

    const db = admin.firestore();

    try {
        // Verify the caller is a manager
        const userDoc = await db.collection('users').doc(context.auth.uid).get();
        if (!userDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'User not found');
        }

        const user = userDoc.data();
        if (!user?.roles?.includes('manager')) {
            throw new functions.https.HttpsError('permission-denied', 'Only managers can remove cars');
        }

        // Get car details
        const carDoc = await db.collection('cars').doc(carId).get();
        if (!carDoc.exists) {
            throw new functions.https.HttpsError('not-found', 'Car not found');
        }

        const car = carDoc.data();

        // Check if car is in use
        if (car?.status === 'in_use') {
            throw new functions.https.HttpsError(
                'failed-precondition',
                'Cannot remove a car that is currently in use'
            );
        }

        // Delete the car
        await db.collection('cars').doc(carId).delete();

        return {
            success: true,
            carId,
            message: 'Car removed from fleet successfully'
        };

    } catch (error) {
        console.error('Error removing car:', error);
        if (error instanceof functions.https.HttpsError) {
            throw error;
        }
        throw new functions.https.HttpsError('internal', 'Failed to remove car');
    }
});
