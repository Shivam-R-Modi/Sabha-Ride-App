
import { db } from './config';
import { doc, writeBatch } from '@firebase/firestore';
import { MOCK_ALL_DRIVERS, MOCK_PENDING_REQUESTS } from '../constants';

export const seedDatabase = async () => {
  console.log("Starting database seed...");
  
  try {
    const batch = writeBatch(db);

    // 1. Seed Drivers
    console.log("Seeding drivers...");
    MOCK_ALL_DRIVERS.forEach(driver => {
      // Use specific IDs (d1, d2...) so we don't duplicate on multiple runs
      const ref = doc(db, 'users', driver.id); 
      batch.set(ref, {
        ...driver,
        role: 'driver',
        accountStatus: 'approved', // Auto-approve seeded drivers
        email: `driver_${driver.id}@example.com`,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      }, { merge: true });
    });

    // 2. Seed Students & Their Requests
    console.log("Seeding students and requests...");
    // MOCK_PENDING_REQUESTS now contains the Boston addresses
    MOCK_PENDING_REQUESTS.forEach((req) => {
      // A. Create the Student User Document
      const studentRef = doc(db, 'users', req.id);
      batch.set(studentRef, {
          id: req.id,
          name: req.name,
          address: req.address,
          phone: req.phone,
          avatarUrl: req.avatarUrl,
          role: 'student',
          accountStatus: 'approved', // Auto-approve seeded students
          createdAt: new Date().toISOString(),
          // Store map coordinates if available
          coordinates: req.coordinates 
      }, { merge: true });

      // B. Create the Ride Request Document
      // We create a deterministic ID for testing: ride_STUDENT_ID
      const rideRef = doc(db, 'rides', `ride_${req.id}`);
      batch.set(rideRef, {
          studentId: req.id,
          studentName: req.name,
          studentAvatarUrl: req.avatarUrl,
          pickupAddress: req.address,
          // Set date to next Friday for relevance
          date: getNextFriday().toISOString(),
          timeSlot: req.requestedTimeSlot,
          status: 'requested',
          createdAt: req.requestTime,
          peers: [],
          isReadyToLeave: false,
          coordinates: req.coordinates, // Persist coordinates for manager map
          notes: "Seeded request for testing"
      }, { merge: true });
    });

    await batch.commit();
    console.log("✅ Database seeded successfully!");
    return true;
  } catch (error) {
    console.error("❌ Error seeding database:", error);
    throw error;
  }
};

// Helper to get next Friday date string
function getNextFriday() {
    const d = new Date();
    d.setDate(d.getDate() + (5 + 7 - d.getDay()) % 7);
    d.setHours(17, 30, 0, 0);
    return d;
}
