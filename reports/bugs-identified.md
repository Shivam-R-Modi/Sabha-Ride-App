# Sabha Ride App - Bug Report
**Date:** 2026-03-31
**Audit Phase:** Phase 1 - Critical Path Verification
**Total Bugs Identified:** 20+

---

## Summary

This report documents all bugs identified during the comprehensive codebase exploration and audit of the Sabha Ride App. Bugs are categorized by severity and priority for fixing.

**Bug Count by Severity:**
- **CRITICAL:** 4 bugs (BUG-001 to BUG-004)
- **HIGH:** 6 bugs (BUG-005 to BUG-010)
- **MEDIUM:** 7 bugs (BUG-011 to BUG-017)
- **LOW:** 3 bugs (BUG-018 to BUG-020)

---

## CRITICAL BUGS (Priority: Fix in Phase 1)

### BUG-001: globalAssignDriver Lock Reference Crash
**Priority:** CRITICAL
**Status:** Identified
**Severity:** High Impact - Application Crash

**Affected Files:**
- `/functions/src/http/globalAssignDriver.ts:357`
- Lock cleanup logic references undefined variable

**Description:**
The error handling block in `globalAssignDriver` attempts to clean up a lock by referencing `lockRef` variable, but this variable is only defined inside the try block after line 67. If an error occurs before the lock is acquired, the error handler will crash with a ReferenceError.

**Steps to Reproduce:**
1. Two drivers click "Assign Me" within 100ms of each other
2. First driver successfully acquires lock
3. Simulate network error or timeout in second driver's request before lock acquisition
4. Check Cloud Functions logs
5. Observe: `ReferenceError: lockRef is not defined` in error handler

**Expected Behavior:**
Lock cleanup should handle errors gracefully, even if lock was never acquired.

**Actual Behavior:**
Application crashes with ReferenceError, lock may remain orphaned in Firestore.

**Root Cause:**
Variable scoping issue - `lockRef` is defined inside try block but referenced in finally/catch blocks outside its scope.

**Proposed Fix:**
```typescript
// Option 1: Define lockRef at function scope
let lockRef: FirebaseFirestore.DocumentReference | null = null;

try {
  lockRef = db.doc('system/assignmentLock');
  // ... rest of logic
} catch (error) {
  // Now safe to reference lockRef
  if (lockRef) {
    await lockRef.delete();
  }
}

// Option 2: Use null check before cleanup
try {
  const lockRef = db.doc('system/assignmentLock');
  // ... rest of logic
} catch (error) {
  try {
    await db.doc('system/assignmentLock').delete();
  } catch (cleanupError) {
    console.error('Lock cleanup failed:', cleanupError);
  }
}
```

**Impact:**
- Application crashes on concurrent assignment requests
- Orphaned locks prevent future assignments
- Requires manual Firestore cleanup

**Test Case Required:**
- Unit test: Concurrent assignment with simulated errors
- Integration test: Lock cleanup verification

---

### BUG-002: Duplicate Student Assignments
**Priority:** CRITICAL
**Status:** Identified
**Severity:** High Impact - Data Integrity

**Affected Files:**
- `/functions/src/http/assignStudentsToDriver.ts:145-170`
- `/functions/src/http/globalAssignDriver.ts:198-210`

**Description:**
The student query in both assignment functions does not filter out students who are already assigned to another driver. This allows the same student to be assigned to multiple drivers simultaneously.

**Steps to Reproduce:**
1. Student submits ride request (status = 'requested')
2. Driver A clicks "Assign Me"
3. Student is assigned to Driver A (but status might not update immediately due to network latency)
4. Before Driver A's assignment transaction commits, Driver B clicks "Assign Me"
5. Student query in Driver B's request returns the same student
6. Student is now assigned to both Driver A and Driver B
7. Check Firestore: Student appears in multiple `rides` documents

**Expected Behavior:**
Each student should only be assigned to one driver at a time.

**Actual Behavior:**
Students can be assigned to multiple drivers, causing confusion and data inconsistency.

**Root Cause:**
Query lacks filter for assignment status:
```typescript
// Current (WRONG)
const rideRequestsSnapshot = await db.collection('rides')
  .where('rideType', '==', rideType)
  .get();

// Should be (CORRECT)
const rideRequestsSnapshot = await db.collection('rides')
  .where('rideType', '==', rideType)
  .where('status', '==', 'requested')  // Only unassigned students
  .get();
```

**Proposed Fix:**
Add status filter to query in both `assignStudentsToDriver.ts` and `globalAssignDriver.ts`:
```typescript
const rideRequestsSnapshot = await db.collection('rides')
  .where('rideType', '==', rideType)
  .where('status', '==', 'requested')
  .get();
```

**Impact:**
- Students assigned to multiple drivers
- Drivers see incorrect student counts
- Ride completion fails due to status conflicts
- Statistics corrupted with duplicate entries

**Test Case Required:**
- Unit test: Concurrent assignment scenarios
- Integration test: Firestore transaction isolation
- E2E test: Two drivers assign same student

---

### BUG-003: Hard-coded Manager Verification Code
**Priority:** CRITICAL
**Status:** Identified
**Severity:** High Impact - Security Vulnerability

**Affected Files:**
- `/functions/src/http/verifyManagerCode.ts:10`

**Description:**
The manager access code is hard-coded directly in the source code as a constant (`const MANAGER_CODE = "SABHA2024"`). This poses multiple security risks:
1. Code is visible to anyone with repository access
2. Cannot be changed without redeploying Cloud Functions
3. No audit trail of who uses the code
4. No expiration or rotation mechanism

**Steps to Reproduce:**
1. Review file: `functions/src/http/verifyManagerCode.ts`
2. Line 10: `const MANAGER_CODE = "SABHA2024";`
3. Attempt to change manager code via UI or settings
4. No UI exists for changing the code
5. Code change requires function redeployment

**Expected Behavior:**
Manager code should be stored in Firestore `settings` collection and configurable by existing managers without code changes.

**Actual Behavior:**
Code is hard-coded, visible in source, and cannot be changed dynamically.

**Root Cause:**
Security best practices not followed - secrets should never be hard-coded.

**Proposed Fix:**
```typescript
// Store in Firestore: settings/managerCode
{
  code: 'SABHA2024',
  createdAt: timestamp,
  expiresAt: timestamp (optional),
  createdBy: managerId
}

// Function logic
export const verifyManagerCode = functions.https.onCall(async (data, context) => {
  const { code } = data;

  // Read from Firestore
  const settingsDoc = await db.doc('settings/managerCode').get();
  const validCode = settingsDoc.data()?.code;

  if (code === validCode) {
    // Auto-approve manager
    await db.doc(`users/${context.auth.uid}`).update({
      accountStatus: 'approved',
      approvedAt: new Date().toISOString(),
      approvedBy: 'manager_code_verification'
    });
    return { valid: true };
  }

  return { valid: false };
});
```

**Impact:**
- Security vulnerability (code exposure)
- Operational inflexibility (cannot rotate code)
- No audit trail
- Potential unauthorized manager registrations

**Test Case Required:**
- Unit test: Code verification logic
- Integration test: Code stored in Firestore
- Security test: Ensure code not logged or exposed

---

### BUG-004: Firestore Rules Collection Name Mismatch
**Priority:** CRITICAL
**Status:** Identified
**Severity:** High Impact - Permission Denied Errors

**Affected Files:**
- `/firestore.rules:126`
- Various code files writing to collections

**Description:**
Firestore security rules reference fields and collections that don't match the actual data schema:
1. Rules check `studentId` field, but rides collection uses `students[]` array
2. Rules reference `statistics` collection, but code may use different name
3. Permission denied errors prevent legitimate data access

**Steps to Reproduce:**
1. Student logs in and requests ride
2. Ride document created with `students: [{ id: 'student123', name: '...' }]`
3. Student tries to read ride document
4. Firestore rules check: `request.auth.uid == resource.data.studentId`
5. Field `studentId` doesn't exist (should check `students` array)
6. Permission denied error

**Expected Behavior:**
Students should be able to read rides they are assigned to.

**Actual Behavior:**
Permission denied due to field name mismatch.

**Root Cause:**
Schema evolved but security rules not updated:
```javascript
// firestore.rules (WRONG)
match /rides/{rideId} {
  allow read: if request.auth.uid == resource.data.studentId;
}

// Actual schema
{
  students: [
    { id: 'student123', name: 'John' },
    { id: 'student456', name: 'Jane' }
  ]
}
```

**Proposed Fix:**
Update Firestore rules to match actual schema:
```javascript
match /rides/{rideId} {
  allow read: if request.auth != null && (
    // Student can read if they're in the students array
    request.auth.uid in resource.data.students.map(s => s.id) ||
    // Driver can read their assigned rides
    request.auth.uid == resource.data.driverId ||
    // Manager can read all
    hasRole('manager')
  );
}
```

**Impact:**
- Students cannot access their ride information
- Real-time listeners fail
- UI shows empty state or errors
- User experience severely degraded

**Test Case Required:**
- Firestore rules test: Student reads own ride
- Firestore rules test: Student cannot read other's ride
- Integration test: Full CRUD operations per role

---

## HIGH PRIORITY BUGS (Fix in Phase 2)

### BUG-005: Hard-coded Sabha Location
**Priority:** HIGH
**Status:** Identified
**Severity:** Medium Impact - Operational Inflexibility

**Affected Files:**
- `/functions/src/http/manualAssignStudent.ts:107`
- Possibly other files

**Description:**
The Sabha (destination) location is hard-coded in multiple files with coordinates for a location in India (28.6139, 77.2090), even though the app should support configurable locations. Managers cannot change the Sabha venue without code changes.

**Steps to Reproduce:**
1. Review `manualAssignStudent.ts` line 107
2. Hard-coded: `const sabhaLocation = { lat: 28.6139, lng: 77.2090 };`
3. Manager navigates to Settings to change Sabha location
4. Location update UI may exist but doesn't affect this function
5. Routes still calculated to hard-coded location

**Expected Behavior:**
All functions should read Sabha location from `settings/main.sabhaLocation` Firestore document.

**Actual Behavior:**
Hard-coded location used, ignoring dynamic settings.

**Root Cause:**
Copy-paste programming - developers copied hard-coded location instead of using `getSabhaLocation()` utility function that already exists.

**Proposed Fix:**
Replace all hard-coded locations with:
```typescript
import { getSabhaLocation } from '../utils/settings';

// In function
const sabhaLocation = await getSabhaLocation();
```

**Impact:**
- Cannot support multiple venues
- Manager settings ignored
- Incorrect routes calculated if Sabha moves

**Test Case Required:**
- Unit test: All functions use dynamic location
- Integration test: Location change propagates

---

### BUG-006: Excessive Console Logging with Sensitive Data
**Priority:** HIGH
**Status:** Identified
**Severity:** Medium Impact - Security/Privacy

**Affected Files:**
- 129 console.log statements across codebase
- Includes frontend and Cloud Functions

**Description:**
Production code contains 129 console.log statements that log sensitive data including:
- User IDs and email addresses
- Student home addresses and coordinates
- Driver assignment details
- Ride request information
- Cloud Function internal state

**Examples:**
```typescript
// globalAssignDriver.ts
console.log('Assigning students:', studentIds);  // PII
console.log('Driver location:', driverLocation);  // Location data

// StudentDashboard.tsx
console.log('User profile:', user);  // Full user object
```

**Expected Behavior:**
- No sensitive data logged in production
- Structured logging with levels (debug, info, warn, error)
- PII redacted or hashed
- Logs only in development mode

**Actual Behavior:**
- Sensitive data visible in browser console
- Cloud Functions logs contain PII
- No log level filtering

**Root Cause:**
Development debugging statements left in production code.

**Proposed Fix:**
1. Remove all console.log statements
2. Implement structured logging:
```typescript
// utils/logger.ts
export const logger = {
  debug: (msg: string, data?: any) => {
    if (process.env.NODE_ENV === 'development') {
      console.debug(msg, data);
    }
  },
  info: (msg: string) => console.info(msg),
  warn: (msg: string, error?: Error) => console.warn(msg, error),
  error: (msg: string, error: Error) => console.error(msg, error),
};

// Usage
logger.debug('Assignment details', { count: students.length }); // Not studentIds
```

**Impact:**
- Privacy violation (GDPR, CCPA concerns)
- Security risk (data exposure)
- Performance impact (excessive logging)

**Test Case Required:**
- Audit: Grep for all console.log statements
- Test: Verify no PII in logs

---

### BUG-007: TypeScript `any` Types (62 instances)
**Priority:** HIGH
**Status:** Identified
**Severity:** Medium Impact - Type Safety

**Affected Files:**
- Multiple files across frontend and backend
- 62 identified instances

**Description:**
TypeScript's type safety is bypassed in 62 locations using `any` type or `@ts-ignore` directives. This defeats the purpose of using TypeScript and can lead to runtime errors.

**Examples:**
```typescript
// types.ts
peers?: any[];  // Should be RideStudent[]

// components/PWAPrompt.tsx
const [deferredPrompt, setDeferredPrompt] = useState<any>(null);  // Should be BeforeInstallPromptEvent

// catch blocks
catch (err: any) {  // Should be Error or unknown
  console.error(err.message);  // Unsafe - err might not have message
}
```

**Expected Behavior:**
All values properly typed, no `any` usage except where truly necessary (with comment explaining why).

**Actual Behavior:**
62 instances of `any` allowing unsafe code.

**Root Cause:**
TypeScript strict mode disabled in `tsconfig.json`:
```json
{
  "strict": false,  // Should be true
  "noImplicitAny": false  // Should be true
}
```

**Proposed Fix:**
1. Enable strict mode
2. Fix all type errors
3. Use proper types:
```typescript
// Before
peers?: any[];

// After
peers?: Array<{ id: string; name: string; status: StudentStatus }>;

// Before
catch (err: any) {
  console.error(err.message);
}

// After
catch (err: unknown) {
  const error = err instanceof Error ? err : new Error(String(err));
  console.error(error.message);
}
```

**Impact:**
- Runtime errors not caught at compile time
- IDE autocomplete broken
- Refactoring risky

**Test Case Required:**
- Enable strict mode, fix all errors
- Verify 0 remaining `any` types

---

### BUG-008: Missing Async Error Boundaries
**Priority:** HIGH
**Status:** Identified
**Severity:** Medium Impact - User Experience

**Affected Files:**
- `/components/ErrorBoundary.tsx`
- All async operations (Cloud Functions, Firestore)

**Description:**
The ErrorBoundary component only catches synchronous rendering errors. Async errors (Cloud Function failures, Firestore errors, network timeouts) are not caught, leading to unhandled promise rejections and white screen of death.

**Steps to Reproduce:**
1. Simulate Cloud Function timeout (disconnect network during assignment)
2. Error thrown in async handler
3. ErrorBoundary does not catch (only catches render errors)
4. User sees blank screen or unhandled error

**Expected Behavior:**
All async errors should be caught and displayed gracefully with retry options.

**Actual Behavior:**
Async errors crash the app or show cryptic error messages.

**Root Cause:**
React ErrorBoundary only catches errors in:
- Render methods
- Lifecycle methods
- Constructors

It does NOT catch:
- Event handlers
- Async code (setTimeout, Promises, async/await)
- Cloud Function callbacks

**Proposed Fix:**
Implement async error handling wrapper:
```typescript
// utils/asyncErrorHandler.ts
export const withAsyncErrorHandling = (fn: Function) => {
  return async (...args: any[]) => {
    try {
      return await fn(...args);
    } catch (error) {
      // Log error
      console.error('Async error:', error);

      // Show user-friendly message
      showErrorNotification(
        'Something went wrong. Please try again.',
        error instanceof Error ? error.message : 'Unknown error'
      );

      // Rethrow if needed
      throw error;
    }
  };
};

// Usage in components
const handleAssignment = withAsyncErrorHandling(async () => {
  await globalAssignDriver(driverId, carId);
});
```

**Impact:**
- Poor user experience (crashes, blank screens)
- No error recovery mechanism
- Users don't know what went wrong

**Test Case Required:**
- E2E test: Simulate network errors
- Unit test: Error handling for each Cloud Function call

---

### BUG-009: Playwright Not Configured (Zero E2E Tests)
**Priority:** HIGH
**Status:** Identified
**Severity:** Low Impact - Testing Gap

**Affected Files:**
- No `playwright.config.ts`
- No `e2e/` directory
- Package installed but unused

**Description:**
Playwright is listed as a dependency (version ^1.41.0) but has never been configured. No E2E tests exist to verify critical user flows end-to-end.

**Steps to Reproduce:**
1. Check for `playwright.config.ts`: File not found
2. Check for `e2e/` directory: Directory not found
3. Run `npx playwright test`: No tests found
4. Critical user flows completely untested

**Expected Behavior:**
20+ E2E tests covering all critical flows (auth, ride request, assignment, completion).

**Actual Behavior:**
0 E2E tests exist.

**Root Cause:**
Playwright added to dependencies but never configured or used.

**Proposed Fix:**
1. Create `playwright.config.ts`
2. Create `e2e/` directory
3. Write E2E tests for critical paths

See approved plan for full E2E test scenarios.

**Impact:**
- No validation of complete user journeys
- Regressions not caught before deployment
- Manual testing burden

**Test Case Required:**
- All 20 E2E tests from approved plan

---

### BUG-010: Race Condition in useAutoDispatch Hook
**Priority:** HIGH
**Status:** Identified
**Severity:** High Impact - Data Integrity

**Affected Files:**
- `/hooks/useAutoDispatch.ts:217 lines`

**Description:**
The `useAutoDispatch` hook listens to Firestore changes and triggers automatic assignment. If 5 students request rides within 1 second, the onSnapshot callback fires 5 times concurrently, potentially causing:
- Duplicate assignment processing
- Lock contention
- Firestore quota exhaustion

**Steps to Reproduce:**
1. Five students click "Request Ride" within 1 second
2. onSnapshot fires 5 times
3. Each callback runs assignment logic concurrently
4. Race condition: multiple assignments attempt to claim same students
5. Possible duplicate assignments or lock deadlocks

**Expected Behavior:**
Assignment requests should be serialized or use proper locking.

**Actual Behavior:**
Concurrent processing without synchronization.

**Root Cause:**
No debouncing or serialization of snapshot events:
```typescript
useEffect(() => {
  const unsubscribe = onSnapshot(query, (snapshot) => {
    snapshot.docChanges().forEach(async (change) => {
      // BUG: Multiple changes processed concurrently
      await processAssignment(change.doc);
    });
  });
}, []);
```

**Proposed Fix:**
Add debouncing and serialization:
```typescript
const [processingQueue, setProcessingQueue] = useState<string[]>([]);

useEffect(() => {
  const unsubscribe = onSnapshot(query, (snapshot) => {
    const changes = snapshot.docChanges();

    // Debounce: Wait for snapshot to settle
    const timer = setTimeout(() => {
      // Serialize: Process one at a time
      processChangesSequentially(changes);
    }, 500);

    return () => clearTimeout(timer);
  });
}, []);
```

**Impact:**
- Duplicate student assignments
- Cloud Function quota exhaustion
- Firestore lock contention

**Test Case Required:**
- Integration test: Concurrent ride requests
- Unit test: Debouncing logic

---

## MEDIUM PRIORITY BUGS (Fix in Phase 3)

### BUG-011: Vehicle Capacity Not Enforced Consistently
**Priority:** MEDIUM
**Status:** Identified

**Description:**
Vehicle capacity checks exist but are not consistently enforced across all assignment functions.

**Impact:** Driver assigned more students than vehicle capacity, safety risk.

---

### BUG-012: Ride History Pagination Missing
**Priority:** MEDIUM
**Status:** Identified

**Description:**
Ride history queries fetch all rides without pagination, causing performance issues for users with 100+ rides.

**Impact:** Slow load times, memory issues, poor UX.

---

### BUG-013: Weekly Attendance Allows Duplicate Submissions
**Priority:** MEDIUM
**Status:** Identified

**Description:**
No Firestore rule or code check prevents students from submitting multiple attendance responses for the same week.

**Impact:** Attendance statistics corrupted.

---

### BUG-014: CSV Export Fails for >100 Rides
**Priority:** MEDIUM
**Status:** Identified

**Description:**
`generateEventCSV` function fetches all rides without pagination, times out for large datasets.

**Impact:** Managers cannot export large events.

---

### BUG-015: PWA Offline Mode Incomplete
**Priority:** MEDIUM
**Status:** Identified

**Description:**
Service worker configured but critical assets not cached, offline mode doesn't work reliably.

**Impact:** App unusable without internet.

---

### BUG-016: FCM Token Not Refreshed on Expiry
**Priority:** MEDIUM
**Status:** Identified

**Description:**
FCM tokens expire after 60 days but app doesn't refresh them automatically.

**Impact:** Notifications stop working after token expiry.

---

### BUG-017: Geocoding Fails Silently
**Priority:** MEDIUM
**Status:** Identified

**Description:**
`geocodeAddress` Cloud Function doesn't validate responses, invalid addresses fail silently.

**Impact:** Users enter invalid addresses, coordinates default to (0, 0).

---

## LOW PRIORITY BUGS (Fix in Phase 4)

### BUG-018: No Rate Limiting on Cloud Functions
**Priority:** LOW
**Status:** Identified

**Description:**
Cloud Functions can be called unlimited times, vulnerable to abuse and quota exhaustion.

**Impact:** Malicious users could exhaust Firebase quota.

---

### BUG-019: Driver Location Not Updating Real-time
**Priority:** LOW
**Status:** Identified

**Description:**
Driver location should update every 5 seconds during active ride, but implementation may be missing.

**Impact:** Students see stale driver location.

---

### BUG-020: Statistics Calculation Has Duplicates
**Priority:** LOW
**Status:** Identified

**Description:**
`statistics/{eventDate}` document appends students without deduplication, same student can appear multiple times if manually reassigned.

**Impact:** Inflated ride counts in reports.

---

## Next Steps

1. **Phase 1 (This Week):**
   - Fix BUG-001 to BUG-004 (critical bugs)
   - Write reproduction test cases
   - Verify fixes with unit and integration tests

2. **Phase 2 (Next Week):**
   - Fix BUG-005 to BUG-010 (high priority)
   - Expand test coverage
   - Security audit

3. **Phase 3 (Week 3):**
   - Fix BUG-011 to BUG-017 (medium priority)
   - Full E2E test suite
   - Performance testing

4. **Phase 4 (Week 4):**
   - Fix BUG-018 to BUG-020 (low priority)
   - Code quality improvements
   - Final audit report

---

**Report Generated:** 2026-03-31
**Next Update:** After Phase 1 completion
