# Sabha Ride Seva - Production Deployment Guide

## Pre-Deployment Checklist

- [ ] All mock data removed from codebase
- [ ] Firestore security rules tightened
- [ ] Firebase project configured
- [ ] First manager account ready to create
- [ ] Initial vehicle fleet data prepared

---

## Step 1: Create First Manager Account

Since there's no self-service manager registration, you need to manually create the first manager.

### Option A: Firebase Console (Recommended for First Setup)

1. **Go to Firebase Console** → Authentication → Users
2. **Create a new user** with email/password or Google sign-in
3. **Note the UID** of the created user
4. **Go to Firestore Database** → users collection
5. **Create a document** with the UID as the document ID:

```json
{
  "name": "Admin Name",
  "email": "admin@example.com",
  "role": "manager",
  "accountStatus": "approved",
  "address": "Your Address",
  "phone": "+1234567890",
  "createdAt": "2026-01-29T00:00:00.000Z"
}
```

### Option B: Using Firebase Admin SDK (For Developers)

If you have Node.js and Firebase Admin SDK set up:

```javascript
const admin = require('firebase-admin');

// Initialize with your service account
admin.initializeApp({
  credential: admin.credential.cert('./serviceAccountKey.json')
});

async function createManager(email, password, name) {
  // Create auth user
  const userRecord = await admin.auth().createUser({
    email: email,
    password: password,
    displayName: name
  });
  
  // Create user document in Firestore
  await admin.firestore().collection('users').doc(userRecord.uid).set({
    name: name,
    email: email,
    role: 'manager',
    accountStatus: 'approved',
    address: '',
    phone: '',
    createdAt: new Date().toISOString()
  });
  
  console.log('Manager created:', userRecord.uid);
}

// Usage
createManager('admin@yourdomain.com', 'securepassword123', 'Admin Name');
```

---

## Step 2: Initialize Vehicle Fleet

The manager dashboard has a Fleet Management feature, but you need at least one vehicle to get started.

### Via Firebase Console:

1. **Go to Firestore Database** → vehicles collection
2. **Create documents** for each vehicle:

```json
{
  "name": "Toyota Sienna",
  "color": "Silver",
  "plateNumber": "ABC-1234",
  "capacity": 7,
  "status": "available",
  "currentDriverId": null,
  "currentDriverName": null
}
```

### Or Use Fleet Management (After First Login):

1. Login as the manager you created
2. Navigate to Fleet Management
3. Add vehicles through the UI

---

## Step 3: Deploy Firestore Rules

```bash
firebase deploy --only firestore:rules
```

---

## Step 4: Build and Deploy

```bash
# Install dependencies
npm install

# Build the app
npm run build

# Deploy to Firebase
firebase deploy --only hosting
```

---

## Step 5: Post-Deployment Configuration

### Add Authorized Domain

1. Go to Firebase Console → Authentication → Settings → Authorized domains
2. Add your deployed domain (e.g., `your-app.web.app`)

### Test the Flow

1. **Register as a student** - Should work immediately
2. **Register as a driver** - Will be in "pending" status
3. **Manager approves driver** - Login as manager, approve the driver
4. **Driver selects vehicle** - Driver can now claim a vehicle
5. **Student requests ride** - Student can request a pickup
6. **Manager assigns ride** - Manager assigns student to available driver

---

## User Roles & Permissions

| Role | Can Do |
|------|--------|
| **Student** | Request rides, view ride status, mark ready to leave |
| **Driver** | View assignments, update stop status, toggle availability |
| **Manager** | Approve drivers, assign rides, manage fleet, view all data |

---

## Security Rules Summary

- **Users**: Authenticated users can read profiles. Users manage own profile. Managers can update any.
- **Rides**: Students create own rides. Drivers read assigned rides. Managers have full access.
- **Vehicles**: All approved users can read. Only managers can create/update/delete.

---

## Troubleshooting

### "Permission Denied" Errors
- Check that the user has `accountStatus: "approved"`
- Verify Firestore rules are deployed: `firebase deploy --only firestore:rules`

### No Drivers Showing in Manager Dashboard
- Ensure drivers have `role: "driver"` and `accountStatus: "approved"`
- Check browser console for errors

### Can't Select Vehicle as Driver
- Ensure vehicles exist in Firestore with `status: "available"`
- Vehicle should have `currentDriverId: null`

---

## Support

For issues or questions, check:
1. Browser console for JavaScript errors
2. Firebase Console → Functions/Database logs
3. Firestore rules playground for permission testing
