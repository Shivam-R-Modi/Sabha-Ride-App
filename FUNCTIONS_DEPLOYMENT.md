# Sabha Ride Seva - Firebase Cloud Functions Deployment Guide

## Overview

This document provides instructions for deploying the Firebase Cloud Functions that power the Sabha Ride Seva application's backend logic.

## Prerequisites

1. **Node.js** (v20 or higher)
2. **Firebase CLI** installed globally:
   ```bash
   npm install -g firebase-tools
   ```
3. **Firebase project** already created and configured
4. **Service account** with appropriate permissions

## Project Structure

```
functions/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Main entry point
│   ├── types.ts                    # TypeScript type definitions
│   ├── utils/
│   │   ├── distance.ts             # Haversine distance calculation
│   │   ├── clustering.ts           # K-means clustering algorithm
│   │   ├── routing.ts              # Route optimization (TSP)
│   │   └── notifications.ts        # FCM push notifications
│   ├── scheduled/
│   │   └── updateRideTypeContext.ts # Auto-detect ride type
│   └── http/
│       ├── assignStudentsToDriver.ts
│       ├── startRide.ts
│       ├── completeRide.ts
│       ├── driverDoneForToday.ts
│       ├── studentReadyToLeave.ts
│       ├── manualAssignStudent.ts
│       ├── fleetManagement.ts
│       └── generateEventCSV.ts
```

## Deployment Steps

### 1. Install Dependencies

```bash
cd functions
npm install
```

### 2. Login to Firebase

```bash
firebase login
```

### 3. Select Your Project

```bash
firebase use sabha-ride-app
```

### 4. Deploy Functions

```bash
# Deploy all functions
firebase deploy --only functions

# Or deploy specific functions
firebase deploy --only functions:assignStudentsToDriver
firebase deploy --only functions:startRide
firebase deploy --only functions:completeRide
```

## Available Functions

### HTTP Callable Functions

| Function | Purpose | Input | Output |
|----------|---------|-------|--------|
| `assignStudentsToDriver` | Assigns students to a driver using K-means clustering | `{ driverId, carId }` | Assignment details with route |
| `startRide` | Marks a ride as in_progress | `{ rideId }` | Success confirmation |
| `completeRide` | Completes a ride and updates stats | `{ rideId }` | Driver stats |
| `driverDoneForToday` | Releases car and marks driver offline | `{ driverId }` | Success confirmation |
| `studentReadyToLeave` | Student requests drop-off | `{ studentId }` | Status update |
| `manualAssignStudent` | Manager manually assigns student | `{ studentId, driverId }` | Updated ride details |
| `addCarToFleet` | Add new vehicle to fleet | `{ model, color, licensePlate, capacity }` | Car details |
| `removeCarFromFleet` | Remove vehicle from fleet | `{ carId }` | Success confirmation |
| `generateEventCSV` | Export event statistics | `{ eventDate }` | CSV content |
| `manuallyUpdateRideContext` | Manually trigger ride type detection | - | Ride context |

### Scheduled Functions

| Function | Schedule | Purpose |
|----------|----------|---------|
| `updateRideTypeContext` | Every 1 minute | Auto-detect pickup/drop-off time |

## Configuration

### Environment Variables

Create a `.env` file in the `functions` directory if needed:

```
# Firebase configuration is automatically available
# No additional env vars required for basic functionality
```

### Firebase Configuration

Ensure your `firebase.json` includes:

```json
{
  "functions": [
    {
      "source": "functions",
      "codebase": "default"
    }
  ]
}
```

## Testing Functions Locally

### 1. Start Emulators

```bash
firebase emulators:start --only functions
```

### 2. Test with cURL

```bash
# Example: Test assignStudentsToDriver
curl -X POST http://localhost:5001/sabha-ride-app/us-central1/assignStudentsToDriver \
  -H "Content-Type: application/json" \
  -d '{"data": {"driverId": "driver123", "carId": "car456"}}' \
  -H "Authorization: Bearer <ID_TOKEN>"
```

### 3. Test from Frontend

Update your frontend to use the emulator:

```typescript
import { connectFunctionsEmulator } from 'firebase/functions';

if (process.env.NODE_ENV === 'development') {
  connectFunctionsEmulator(functions, 'localhost', 5001);
}
```

## Monitoring & Logs

### View Function Logs

```bash
# All functions
firebase functions:log

# Specific function
firebase functions:log --only assignStudentsToDriver

# Follow logs
firebase functions:log --tail
```

### Cloud Console

- Go to [Firebase Console](https://console.firebase.google.com/)
- Navigate to **Functions** section
- View metrics, logs, and execution details

## Troubleshooting

### Common Issues

1. **"Cannot find module" errors**
   - Run `npm install` in the functions directory
   - Ensure all imports use correct paths

2. **Permission denied errors**
   - Check Firestore security rules
   - Verify user has correct role (manager/driver/student)

3. **Functions timeout**
   - K-means clustering may take time with many students
   - Consider increasing function timeout in `package.json`:
     ```json
     "functions": {
       "timeoutSeconds": 60
     }
     ```

4. **CORS errors**
   - Ensure proper CORS configuration in functions
   - Check origin whitelist in Firebase Console

### Error Codes

| Code | Meaning | Solution |
|------|---------|----------|
| `unauthenticated` | User not logged in | Ensure user is authenticated |
| `permission-denied` | Insufficient role | Check user roles array |
| `not-found` | Document doesn't exist | Verify IDs are correct |
| `failed-precondition` | Business rule violation | Check status/state constraints |
| `already-exists` | Duplicate data | License plate already exists |

## Security Rules

Ensure your Firestore security rules allow function operations:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Allow functions to read/write all documents
    match /{document=**} {
      allow read, write: if request.auth != null;
    }
  }
}
```

## Cost Optimization

### Free Tier Limits (Spark Plan)
- 125,000 invocations/month
- 40,000 GB-seconds/month
- 40,000 CPU-seconds/month

### Best Practices
1. Use caching for ride context
2. Batch Firestore writes
3. Minimize cold starts with minimum instances:
   ```json
   "functions": {
     "minInstances": 1
   }
   ```

## Next Steps

After deployment:

1. **Test all functions** using the test scripts
2. **Configure monitoring** alerts in Firebase Console
3. **Set up CI/CD** for automated deployments
4. **Document API** for frontend developers

## Support

For issues or questions:
- Check Firebase documentation: https://firebase.google.com/docs/functions
- Review function logs in Firebase Console
- Test locally with emulators before deploying
