const admin = require("firebase-admin");
const serviceAccount = require("../sabha-ride-app-firebase-adminsdk-fbsvc-24095ed3d5.json");

admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
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
        console.error("Error:", error);
    }
    process.exit(0);
}

setRideContext();
