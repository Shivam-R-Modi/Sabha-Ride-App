// Run from functions directory: node setRideContext.cjs
const admin = require("firebase-admin");

// Initialize with project ID
admin.initializeApp({
    projectId: "sabha-ride-app"
});

const db = admin.firestore();

async function setRideContext() {
    try {
        await db.collection("system").doc("rideContext").set({
            rideType: "home-to-sabha",
            displayText: "Home → Sabha (Test Mode)",
            timeContext: "Test mode - rides enabled",
            lastUpdated: new Date().toISOString()
        });
        console.log("✅ Ride context set to 'home-to-sabha'");
        console.log("   You can now test the 'Assign Me' button!");
    } catch (error) {
        console.error("Error:", error.message || error);
    }
    process.exit(0);
}

setRideContext();
