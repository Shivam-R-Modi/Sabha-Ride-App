# SABHA RIDE SEVA - COMPLETE SPECIFICATION

**Purpose:** Replace existing workflow with streamlined automated ride coordination system  
**Target:** 100+ students, 8 drivers, 1 manager  
**Goal:** 80% reduction in coordination time, 20-30% reduction in mileage

---

## TABLE OF CONTENTS

1. [System Overview](#1-system-overview)
2. [User Flows - Student](#2-user-flows---student)
3. [User Flows - Driver](#3-user-flows---driver)
4. [User Flows - Manager](#4-user-flows---manager)
5. [Role Switching System](#5-role-switching-system)
6. [Core Algorithms](#6-core-algorithms)
7. [Integrations](#7-integrations)
8. [Business Logic Rules](#8-business-logic-rules)
9. [Data Requirements](#9-data-requirements)
10. [Automation Rules](#10-automation-rules)

---

## 1. SYSTEM OVERVIEW

### 1.1 Core Concept

**The Big Picture:**
- Students wait passively, get auto-assigned to drivers
- Drivers select cars (no memory), click "Assign Me" to get students
- Manager only intervenes for exceptions
- System automatically detects if it's pickup time (before 7 PM) or drop-off time (after 10 PM)
- Everything is location-based clustering - no manual time slot selection

### 1.2 What This Replaces

**Remove These Concepts:**
- Student choosing time slots
- Live tracking with moving dots on maps
- ETA countdown timers
- Progress tracking ("2 of 4 stops completed")
- Rating drivers after rides
- In-app chat or call between students and drivers
- Remembering which car a driver used last time
- Manual toggle for "pickup" vs "drop-off" rides
- Driver performance dashboards
- Detailed analytics and trend analysis

**Keep These Concepts:**
- Location-based automatic assignment
- Google Maps for navigation (external app)
- Manual assignment by manager when automation fails
- Fleet management (add/remove cars)
- Simple statistics (count of students, export list)

---

## 2. USER FLOWS - STUDENT

### 2.1 Initial State (Before Sabha)

**What Student Sees:**
- Dashboard showing next Sabha event details (date, time, location)
- Their saved home address with option to edit
- Pickup section showing "Waiting for driver..." status
- Drop-off section showing "After Sabha" (inactive)

**What Happens Behind The Scenes:**
- System marks student as "waiting for pickup assignment"
- Student location is stored in database
- Student appears in pool of unassigned students
- When any driver clicks "Assign Me", algorithm might pick this student

**User Actions Available:**
- Edit their home location if needed
- Wait (no other action required)

### 2.2 Getting Assigned to Driver (Pickup)

**Trigger:**
- Driver clicks "Assign Me" button
- Algorithm runs and assigns this student to that driver

**What Student Sees:**
- Notification: "Driver Assigned"
- Screen updates to show:
  - Driver's name
  - Car model and color
  - License plate number
  - Message: "Driver will arrive shortly"
  - Their pickup address displayed

**What Student Does NOT See:**
- No ETA countdown
- No "you are stop 2 of 4"
- No call/chat buttons
- No live map showing driver location

**User Actions Available:**
- Just wait and be ready at their location
- That's it - totally passive

### 2.3 During Ride to Sabha

**Trigger:**
- Driver starts the ride

**What Student Sees:**
- Screen showing:
  - "Riding to Sabha"
  - Driver name and car details (static info)
  - List of other student names in the same car
  - Status: "In Progress"

**What Student Does NOT See:**
- No live map
- No "next stop" updates
- No progress bar

**User Actions Available:**
- None - just informational view

### 2.4 Arriving at Sabha

**Trigger:**
- Driver clicks "Complete Ride" after dropping everyone

**What Student Sees:**
- Success screen: "Arrived at Sabha!"
- Thank you message
- "Enjoy Sabha!" greeting
- Back to dashboard button

**What Happens Behind The Scenes:**
- Student status changes to "at Sabha"
- Pickup ride is marked complete
- Student now eligible for drop-off later

**User Actions Available:**
- Return to dashboard

### 2.5 After Sabha - Requesting Drop-off

**Trigger:**
- Time becomes 10 PM or later on Friday
- Student is ready to leave

**What Student Sees:**
- Drop-off section now shows active "Ready to Leave" button
- Instructions: "Click when ready to leave Sabha"

**User Actions Available:**
- Click "Ready to Leave" button

**What Happens Behind The Scenes:**
- Student status changes to "waiting for drop-off assignment"
- Student appears in pool for drop-off assignments
- Algorithm can now assign them to drop-off drivers

### 2.6 Getting Assigned to Driver (Drop-off)

**Same as pickup flow (2.2)** but direction is Sabha → Home

### 2.7 During Ride Home

**Same as pickup ride (2.3)** but going home

### 2.8 Arriving Home

**Trigger:**
- Driver completes drop-off ride

**What Student Sees:**
- Success screen: "Home Safe!"
- Thank you message
- Completion confirmation

**What Happens Behind The Scenes:**
- Student status changes to "home safe"
- Drop-off ride is marked complete
- Student's journey for this Sabha is complete

---

## 3. USER FLOWS - DRIVER

### 3.1 Opening App (Ride Type Auto-Detection)

**What Driver Sees:**
- Dashboard with automatically detected ride type
  - If before 7 PM Friday: Shows "Home → Sabha (Auto-detected)" with note "Before Sabha starts"
  - If after 10 PM Friday: Shows "Sabha → Home (Auto-detected)" with note "After Sabha ends"
  - If not Friday or during Sabha: Shows "No rides available" with explanation

**What Happens Behind The Scenes:**
- System checks current day and time
- Automatically determines ride type
- Updates this every minute via scheduled task

**No Manual Toggle:**
- Driver cannot choose pickup vs drop-off
- Completely automatic based on time

### 3.2 Selecting Car (No Persistence)

**What Driver Sees:**
- List of available cars showing:
  - Car model
  - Color
  - License plate
  - Seating capacity
  - Status (Free/In Use)
- Radio buttons to select one car
- "Assign Me" button (disabled until car selected)

**Business Rules:**
- Driver MUST select a car every time they open the app
- System does NOT remember which car they used last time
- System does NOT auto-select any car
- Only cars marked "Available" are shown

**User Actions Available:**
- Select one car via radio button
- Click "Assign Me" once car is selected

### 3.3 Getting Student Assignment

**Trigger:**
- Driver clicks "Assign Me" button

**What Happens Behind The Scenes:**
- System finds all students waiting for assignment (for current ride type)
- Algorithm runs location clustering
- Algorithm picks students near driver's location
- Algorithm respects car capacity
- Algorithm optimizes route order
- Assignment is created and saved

**What Driver Sees:**
- Assignment Preview Screen showing:
  - Ride number (e.g., "Ride #3")
  - Route type (Home → Sabha or Sabha → Home)
  - Number of students assigned vs car capacity (e.g., "4/6 seats")
  - Estimated distance in kilometers
  - Estimated time in minutes
  - Route preview with:
    - Start point
    - Each student's name and distance between stops
    - End point
  - Two buttons: "Accept & Start" and "Release Assignment"

**User Actions Available:**
- Click "Accept & Start" to proceed with this assignment
- Click "Release Assignment" if unavailable (students go back to unassigned pool)
- Optionally view map preview before accepting

### 3.4 Active Ride

**Trigger:**
- Driver clicks "Accept & Start"

**What Driver Sees:**
- Simple screen showing:
  - "Ride In Progress"
  - Number of students assigned
  - Route type
  - Big button: "Open in Google Maps"
  - "Complete Ride" button (initially disabled)

**What Happens Behind The Scenes:**
- Ride status changes to "in progress"
- All assigned students see "Riding to [destination]"
- System tracks driver's GPS location silently
- When driver gets within 50 meters of each waypoint, system marks it as "visited"
- When final waypoint is visited, "Complete Ride" button becomes enabled

**User Actions Available:**
- Click "Open in Google Maps" which launches external Google Maps app with all waypoints pre-loaded
- Click "Complete Ride" once enabled (only after visiting all stops)

**Important:**
- No in-app navigation
- No progress indicators shown to driver
- No student contact buttons
- Driver uses Google Maps for navigation

### 3.5 Ride Completion

**Trigger:**
- Driver clicks "Complete Ride" after final waypoint

**What Driver Sees:**
- Completion screen showing:
  - "Ride #3 Completed ✓"
  - Summary: "4 students • 8.2 km • 28 mins"
  - Question: "Want to do another ride?"
  - Two buttons:
    - "Yes, Assign Next Ride"
    - "No, I'm Done for Today"
  - Today's stats: Total rides, total students, total distance

**What Happens Behind The Scenes:**
- Ride is marked complete in database
- All students in this ride have their status updated
- Driver's session stats are updated
- Statistics for the event are updated

**User Actions Available:**
- Click "Yes, Assign Next Ride" → loops back to 3.3 (getting new assignment)
- Click "No, I'm Done for Today" → proceeds to 3.6

### 3.6 Done for Today (Car Release)

**Trigger:**
- Driver clicks "No, I'm Done for Today"

**What Happens Behind The Scenes:**
- Selected car is released back to fleet
- Car status changes to "Available"
- Car is no longer assigned to this driver
- Driver status changes to "Offline"
- Driver's currentCar field is cleared (no persistence)

**What Driver Sees:**
- Thank you message
- Option to logout or stay on dashboard

**Critical Business Rule:**
- Next time this driver logs in and wants to drive, they MUST select a car again
- System will NOT remember or suggest their previous car
- This is intentional to prevent car "hogging"

---

## 4. USER FLOWS - MANAGER

### 4.1 Operations Dashboard

**What Manager Sees:**
- Event header (Date, time of Sabha)
- Section 1: "Current Rides in Progress"
  - List of active rides
  - Each ride shows:
    - Ride number
    - Driver name and car
    - List of student names in that ride
    - Route type (Home → Sabha or Sabha → Home)
    - Status (Assigned / In Progress)
- Section 2: "Unassigned Students"
  - Count of students waiting
  - List of student names and addresses
  - Button: "Manual Assignment Mode"
- Two action buttons at bottom:
  - "Car Fleet Management"
  - "View Statistics"

**What Manager Does NOT See:**
- No live map with moving pins
- No color-coded alerts
- No coverage percentages
- No real-time ETA tracking
- No driver performance scores

**What Happens Behind The Scenes:**
- System constantly updates list of active rides
- System constantly updates list of unassigned students
- Updates happen automatically as drivers accept assignments and complete rides

### 4.2 Manual Assignment (Exception Handling)

**Trigger:**
- Manager clicks "Manual Assignment Mode"
- Usually used when students aren't getting auto-assigned

**What Manager Sees:**
- Student Details:
  - Selected student's name
  - Their address
  - Phone number
- Available Drivers section:
  - List of drivers currently in rides
  - For each driver shows:
    - Driver name
    - Car model and current capacity usage (e.g., "2/4 seats")
    - Distance from student
    - Impact on route if this student is added (e.g., "+8 mins")
  - System highlights recommended driver (closest with capacity)
- Two buttons:
  - "Assign to Recommended"
  - "Choose Manually" (to select different driver)

**What Happens Behind The Scenes:**
- System calculates distance from student to each active driver
- System checks each driver's remaining capacity
- System estimates time impact if student is added to route
- System recommends best option based on proximity and capacity

**User Actions Available:**
- Click "Assign to Recommended" for quick assignment
- Select different driver and click "Choose Manually"
- Assignment is immediately saved
- Student is removed from unassigned list
- Added to selected driver's ride

### 4.3 Fleet Management

**What Manager Sees:**
- Header: "Car Fleet Management"
- Count of total cars in fleet
- List of all cars showing:
  - Car model (e.g., "Honda City")
  - Color (e.g., "Blue")
  - License plate (e.g., "DL01AB1234")
  - Seating capacity
  - Current status:
    - "Available" (with option to remove)
    - "In Use (Driver Name)" (cannot remove)
  - "View Details" button for each car
- Button at bottom: "Add New Car to Fleet"

**Adding New Car:**
- Click "Add New Car"
- Form appears with fields:
  - Car Model (text input)
  - Color (text input)
  - License Plate (text input)
  - Seating Capacity (number, 2-10)
- Submit to add car
- Car immediately appears in fleet as "Available"

**Removing Car:**
- Only possible if car is "Available" (not in use)
- Click "Remove from Fleet"
- Confirmation prompt
- Car is deleted from database

**User Actions Available:**
- Add cars to fleet
- Remove available cars from fleet
- View car details
- Cannot modify cars currently in use

### 4.4 Statistics View

**What Manager Sees:**
- Event date at top
- Section 1: "Pickup Rides (Home → Sabha)"
  - Total count of students picked up
  - Expandable list (click to expand)
  - When expanded shows:
    - Each student's name
    - Which driver picked them up
    - Which car was used
- Section 2: "Drop-off Rides (Sabha → Home)"
  - Total count of students dropped off
  - Expandable list (same format as pickup)
- Section 3: "Attendance Breakdown"
  - Count of students who used both pickup and drop-off
  - Count of students who only used pickup (went home on their own)
  - Count of students who only used drop-off (came on their own)
- Button at bottom: "Download CSV"

**What Manager Does NOT See:**
- No route efficiency percentages
- No distance/time metrics
- No comparison to previous weeks
- No driver performance rankings
- No fuel savings calculations
- No manager time savings stats

**Download CSV:**
- Click button
- System generates CSV file with columns:
  - Event Date
  - Event Type (Both / Pickup Only / Drop-off Only)
  - Student Name
  - Pickup Driver
  - Pickup Car
  - Drop-off Driver
  - Drop-off Car
- File downloads to manager's device

**User Actions Available:**
- Expand/collapse student lists
- Download CSV export
- View summary statistics

---

## 5. ROLE SWITCHING SYSTEM

### 5.1 Role Structure

**Three Roles:**
1. Student - Lowest privilege
2. Driver - Medium privilege
3. Manager - Highest privilege

**Role Assignment:**
- Each user account has a "roles" array listing which roles they can access
- Each user has an "activeRole" field showing which role they're currently using
- Examples:
  - Manager account: roles = ["manager", "driver", "student"]
  - Driver account: roles = ["driver", "student"]
  - Student account: roles = ["student"]

### 5.2 Switching Rules

**Manager Can:**
- Switch to Driver mode anytime
- Switch to Student mode anytime
- Warning shown if unassigned students exist when switching away
- When switching to Driver: Must select car like any driver
- When switching to Student: Sees student dashboard like any student

**Driver Can:**
- Switch to Student mode anytime
- CANNOT switch to Manager mode (lacks permission)
- Cannot switch if currently in active ride
- If switching away from Driver mode, car is automatically released

**Student Can:**
- CANNOT switch to any other role
- No role switcher shown in UI

### 5.3 Role Switcher UI Location

**Where:**
- Top-right corner of every screen
- Shows current role name with dropdown arrow
- Clicking opens dropdown menu

**Dropdown Contents:**
- List of available roles (based on user's roles array)
- Current role shown with checkmark
- "Settings" option
- "Logout" option

**Switching Process:**
1. User clicks role switcher
2. Selects different role from dropdown
3. System checks if switch is allowed (rules in 5.2)
4. If allowed: activeRole is updated in database
5. App redirects to appropriate dashboard
6. All subsequent screens show according to new role

---

## 6. CORE ALGORITHMS

### 6.1 Location Clustering Algorithm (K-Means)

**Purpose:**
- Group students by geographic proximity
- Assign each group to nearest available driver
- Minimize total distance traveled

**Input Data:**
- List of students waiting for assignment (with lat/lng coordinates)
- List of available drivers (with current location lat/lng)
- Each driver's car capacity

**Process:**
1. Count how many drivers are available → this is "K" (number of clusters)
2. Use K-means clustering algorithm:
   - Randomly pick K students as initial "center points"
   - Assign each student to nearest center point
   - Recalculate center point for each group (average lat/lng)
   - Reassign students to new nearest center
   - Repeat until groups stop changing (or max 10 iterations)
3. Now you have K groups of students
4. For each group:
   - Find the driver whose current location is closest to that group's center
   - Check if driver has enough seats for all students in group
   - If yes: assign this group to this driver
   - If no: split group and handle overflow students separately

**Output:**
- Assignment object for each driver containing:
  - Driver ID
  - List of student IDs
  - Optimized route order (see 6.2)
  - Total estimated distance
  - Total estimated time

**Fallback:**
- If some students don't fit in any driver's car: mark them as "unassigned"
- Manager will see these in unassigned students list
- Manager can manually assign them

### 6.2 Route Optimization (Traveling Salesman Problem - Nearest Neighbor)

**Purpose:**
- Given a list of students assigned to one driver, find the most efficient order to pick them up/drop them off

**Input Data:**
- Starting point (driver's current location for pickup, or Sabha location for drop-off)
- List of student locations (lat/lng)
- Ending point (Sabha location for pickup, or driver's home for drop-off)

**Process:**
1. Start at starting point
2. From current location, find the nearest unvisited student location
3. Move to that location, mark it as visited
4. Repeat step 2 until all students are visited
5. Finally, go to ending point

**Output:**
- Ordered list of waypoints:
  - Start location
  - Student 1 location
  - Student 2 location
  - Student N location
  - End location
- Total distance (sum of distances between consecutive points)
- Estimated time (distance ÷ average speed, e.g., 30 km/h in city)

**Distance Calculation:**
- Use Haversine formula to calculate distance between two lat/lng points
- Formula accounts for Earth's curvature
- Returns distance in kilometers

### 6.3 Ride Type Auto-Detection

**Purpose:**
- Automatically determine if it's pickup time or drop-off time
- Remove need for manual toggle

**Process:**
- Check current day of week
- Check current hour
- Apply these rules:
  - If NOT Friday → No rides available
  - If Friday AND before 7 PM (hour < 19) → Pickup rides (Home → Sabha)
  - If Friday AND after 10 PM (hour >= 22) → Drop-off rides (Sabha → Home)
  - If Friday AND between 7 PM - 10 PM → During Sabha (no rides)

**How It Runs:**
- Scheduled task runs every 1 minute
- Updates "ride context" in database with:
  - Current ride type (home-to-sabha / sabha-to-home / null)
  - Display text (e.g., "Home → Sabha (Auto-detected)")
  - Time context (e.g., "Before Sabha starts")
  - Timestamp of last update

**Usage:**
- Driver dashboard reads this ride context
- Shows detected ride type automatically
- Assignment algorithm filters students based on this type

### 6.4 Waypoint Tracking for Ride Completion

**Purpose:**
- Detect when driver has visited all stops
- Enable "Complete Ride" button only after final waypoint

**How It Works:**
- When ride starts, system has ordered list of waypoints
- System continuously monitors driver's GPS location
- For each waypoint:
  - Calculate distance from driver's current location to waypoint
  - If distance < 50 meters: mark waypoint as "visited"
- When all waypoints are marked "visited": enable "Complete Ride" button

**Fallback:**
- If GPS tracking fails or driver manually completes without visiting all waypoints
- System allows completion anyway but logs the discrepancy
- This handles edge cases (student not present, technical issues)

---

## 7. INTEGRATIONS

### 7.1 Firebase Authentication

**Purpose:**
- User login/logout
- Secure access control
- User session management

**Requirements:**
- Support email/password authentication
- Store user's unique ID (UID)
- Link UID to user profile in database

**User Registration Flow:**
1. New user provides email and password
2. Firebase creates authentication account
3. System creates user profile in database:
   - Set default role based on registration type
   - Initialize empty fields (location, etc.)
4. User can now login

**Login Flow:**
1. User provides credentials
2. Firebase validates
3. System retrieves user profile from database
4. App shows dashboard based on user's activeRole

### 7.2 Firebase Realtime Database

**Purpose:**
- Store all app data
- Real-time synchronization across devices
- Offline support

**Main Collections Needed:**
1. **users** - User profiles with roles
2. **students** - Student-specific data (location, status, current ride)
3. **drivers** - Driver-specific data (current car, stats, status)
4. **cars** - Fleet inventory (model, capacity, status, assigned driver)
5. **rides** - All ride records (driver, students, route, status, timestamps)
6. **unassignedStudents** - Temporary holding for students without drivers
7. **statistics** - Event-wise statistics for manager reports
8. **system** - System-wide data (ride context, configurations)

**Real-time Listeners:**
- Student dashboard listens to their student record and current ride
- Driver dashboard listens to available cars and ride context
- Manager dashboard listens to active rides and unassigned students
- When data changes in database, UI updates instantly

### 7.3 Firebase Cloud Functions

**Purpose:**
- Run backend logic
- Scheduled tasks
- API endpoints for complex operations

**Required Functions:**

**Function 1: updateRideTypeContext (Scheduled)**
- Runs every 1 minute
- Calls ride type detection algorithm
- Updates system/rideContext in database
- No input parameters
- Runs automatically

**Function 2: assignStudentsToDriver (API endpoint)**
- Triggered when driver clicks "Assign Me"
- Input: driverId, carId
- Process:
  - Get current ride context
  - Get waiting students for that ride type
  - Run clustering algorithm
  - Create assignment
  - Update database (create ride, update student statuses, update driver status)
- Output: Assignment details (students, route, distance, time)

**Function 3: startRide (API endpoint)**
- Triggered when driver clicks "Accept & Start"
- Input: rideId
- Process:
  - Update ride status to "in_progress"
  - Set start timestamp
  - Notify all assigned students
- Output: Success confirmation

**Function 4: completeRide (API endpoint)**
- Triggered when driver clicks "Complete Ride"
- Input: rideId, driverId
- Process:
  - Update ride status to "completed"
  - Set completion timestamp
  - Update driver stats (rides completed, students served, distance)
  - Update student statuses
  - Update event statistics
- Output: Driver's today stats

**Function 5: driverDoneForToday (API endpoint)**
- Triggered when driver clicks "No, I'm Done for Today"
- Input: driverId
- Process:
  - Get driver's current car
  - Release car (set status to available, clear assigned driver)
  - Clear driver's current car (no persistence)
  - Set driver status to offline
- Output: Success confirmation

**Function 6: studentReadyToLeave (API endpoint)**
- Triggered when student clicks "Ready to Leave"
- Input: studentId
- Process:
  - Update student status to "waiting_for_assignment"
  - Set dropoffRequested to true
  - Student now available for drop-off assignments
- Output: Success confirmation

**Function 7: manualAssignStudent (API endpoint)**
- Triggered when manager manually assigns student
- Input: studentId, driverId
- Process:
  - Get driver's active ride
  - Add student to that ride's student list
  - Update student status and current ride
  - Remove student from unassigned list
  - Recalculate driver's route with new student
- Output: Updated ride details

**Function 8: addCarToFleet (API endpoint)**
- Triggered when manager adds new car
- Input: model, color, licensePlate, capacity
- Process:
  - Create new car record in database
  - Set status to "available"
  - Set assignedDriver to null
- Output: New car ID

**Function 9: removeCarFromFleet (API endpoint)**
- Triggered when manager removes car
- Input: carId
- Process:
  - Check if car is in use (reject if yes)
  - Delete car record from database
- Output: Success confirmation

**Function 10: generateEventCSV (API endpoint)**
- Triggered when manager clicks "Download CSV"
- Input: eventDate
- Process:
  - Get pickup statistics for that date
  - Get drop-off statistics for that date
  - Combine data matching students
  - Format as CSV string
- Output: CSV file content

### 7.4 Google Maps Integration

**Purpose:**
- Navigation for drivers
- Route visualization
- Distance calculations

**Implementation Method:**
- DO NOT build in-app navigation
- Use external Google Maps app launch
- Pre-load waypoints into Google Maps URL

**Required API Key:**
- Google Maps JavaScript API key
- Store in environment variables
- Enable in Google Cloud Console:
  - Maps JavaScript API
  - Directions API
  - Geocoding API (if needed for address → lat/lng)

**How It Works:**
1. When driver clicks "Open in Google Maps":
2. System gets ride's ordered waypoint list
3. System constructs Google Maps URL with parameters:
   - origin = first waypoint (lat,lng)
   - destination = last waypoint (lat,lng)
   - waypoints = all middle waypoints separated by | character
   - travelmode = driving
4. System opens this URL in new tab (web) or Google Maps app (mobile)
5. Google Maps shows route with all stops pre-loaded
6. Driver follows Google Maps navigation
7. Driver returns to app when done to click "Complete Ride"

**Static Map Preview (Optional):**
- For assignment preview screen
- Use Google Static Maps API
- Generate image URL showing route with markers
- Display image in preview
- Does not require live map component

### 7.5 Firebase Cloud Messaging (Push Notifications)

**Purpose:**
- Notify students when driver is assigned
- Notify drivers when students are assigned
- Send important updates

**Required Setup:**
- Firebase Cloud Messaging enabled in Firebase Console
- VAPID key configured for web push
- Service worker registered in PWA

**Notification Triggers:**

**Trigger 1: Student assigned to driver**
- Sent to: Student
- Title: "Driver Assigned ✓"
- Body: "[Driver Name] will pick you up in [Car Model]"
- Action: Open app to student dashboard

**Trigger 2: Students assigned to driver**
- Sent to: Driver
- Title: "Students Assigned"
- Body: "You have been assigned [N] students"
- Action: Open app to assignment preview

**Trigger 3: Ride starting soon (Optional)**
- Can be added if needed
- Sent to students when driver accepts assignment

**How It Works:**
1. When user logs in, app requests notification permission
2. If granted, app gets FCM token
3. Token is saved to user's profile in database
4. When event happens (e.g., assignment created):
   - Cloud function triggers
   - Function looks up user's FCM token
   - Function sends notification via Firebase Cloud Messaging
   - User receives push notification on their device

**In-App Fallback:**
- If notifications are disabled
- Show in-app banner/toast instead
- Real-time database listeners ensure UI updates anyway

---

## 8. BUSINESS LOGIC RULES

### 8.1 Student Rules

**Status Flow:**
```
waiting_for_assignment → assigned → in_ride → at_sabha → waiting_for_assignment → assigned → in_ride → home_safe
```

**Assignment Rules:**
- Student can only be assigned to ONE ride at a time
- Student cannot be in both pickup and drop-off simultaneously
- Student cannot request drop-off until they've been marked "at Sabha"

**Location Rules:**
- Student must have saved location before requesting rides
- Location can be edited anytime before assignment
- Location cannot be changed once assigned to a ride

**Drop-off Rules:**
- "Ready to Leave" button only shows after 10 PM on Friday
- Student must manually click button (not automatic)
- If student doesn't click, they won't get drop-off assignment

### 8.2 Driver Rules

**Car Rules:**
- Driver MUST select car every session (no memory)
- Driver can only use ONE car at a time
- Driver cannot select car that's "In Use" by another driver
- When driver clicks "Done for Today", car is immediately released
- Next session, driver starts fresh with car selection

**Assignment Rules:**
- Driver can only get assignment if they have selected a car
- Driver can only have ONE active ride at a time
- Driver must complete current ride before getting next assignment
- Driver can decline assignment (releases students back to pool)

**Capacity Rules:**
- System will never assign more students than car's capacity
- If car has 4 seats, maximum 4 students assigned
- Assignment algorithm respects this strictly

**Continuation Rules:**
- After completing ride, driver chooses:
  - Continue → stays in driver mode, keeps car, can get new assignment
  - Done → releases car, logs out or stays as different role

**Status Flow:**
```
offline → ready_for_assignment → assigned → active_ride → ready_for_assignment (loop) → offline
```

### 8.3 Manager Rules

**Access Rules:**
- Manager can view all rides across all drivers
- Manager can view all students (assigned and unassigned)
- Manager can intervene anytime with manual assignment
- Manager actions bypass normal automation

**Fleet Management Rules:**
- Manager can add unlimited cars to fleet
- Manager can only remove cars that are "Available"
- Cannot remove cars currently in use
- Car model, capacity, license plate required for new car

**Manual Assignment Rules:**
- Manager can assign any unassigned student to any active driver
- Manager must respect car capacity (system enforces)
- Manual assignment immediately takes effect
- Student removed from unassigned list
- Driver's route automatically recalculated

**Statistics Rules:**
- Manager can only export data for past or current Sabha events
- Cannot modify historical statistics
- CSV export includes all students who used any ride

### 8.4 Ride Rules

**Ride Creation:**
- Ride is created when driver accepts assignment
- Ride must have at least 1 student
- Ride cannot exceed car capacity
- Ride type (pickup/dropoff) is automatically set from ride context

**Ride Status Flow:**
```
assigned → in_progress → completed
```

**Ride Completion:**
- Driver must visit all waypoints OR
- Driver can force complete (edge cases)
- Once completed, cannot be reopened
- Completion triggers student status updates

**Route Rules:**
- Route is calculated once at assignment time
- Route can be recalculated if manager adds student manually
- Route order is optimized for minimum distance
- Route includes driver start → all students → destination end

### 8.5 Time-Based Rules

**Friday Rules:**
- Before 7 PM: Only pickup rides available
- 7 PM - 10 PM: No rides (Sabha in progress)
- After 10 PM: Only drop-off rides available

**Non-Friday Rules:**
- System shows "No rides available"
- Students cannot request rides
- Drivers cannot get assignments
- Manager can still view historical data and manage fleet

**Auto-Detection:**
- System checks time every minute
- Updates ride context automatically
- No manual override allowed
- Ensures ride type is always correct

### 8.6 Data Consistency Rules

**Student Constraints:**
- Cannot be in two rides simultaneously
- Cannot be "assigned" without a rideId
- Cannot request drop-off before pickup completed
- Location required before any assignment

**Driver Constraints:**
- Cannot have activeRide without currentCar
- Cannot have currentCar marked as "available"
- Cannot have multiple active rides
- Stats (rides completed, students served) only increment, never decrease

**Car Constraints:**
- Cannot be "available" while assigned to driver
- Cannot be assigned to multiple drivers
- Capacity must be between 2-10 seats
- License plate must be unique

**Ride Constraints:**
- Must have valid driverId and carId
- Student list cannot exceed car capacity
- Cannot have completed status without completedAt timestamp
- Route must start and end at different locations

---

## 9. DATA REQUIREMENTS

### 9.1 User Data Structure

**Fields:**
- id (unique identifier)
- email (for login)
- name (full name)
- phone (contact number)
- roles (array: which roles they can access)
- activeRole (string: current role being used)
- createdAt (timestamp of account creation)
- lastActive (timestamp of last login)

**Relationships:**
- One user can be student, driver, manager (or any combination)
- User ID links to student record, driver record, or neither

### 9.2 Student Data Structure

**Fields:**
- id (unique identifier, can match user id)
- userId (link to user account)
- name (full name, copied from user)
- location (object):
  - lat (latitude number)
  - lng (longitude number)
  - address (human-readable street address)
- phone (contact number)
- status (string: waiting_for_assignment / assigned / in_ride / at_sabha / home_safe)
- currentRide (string: ride ID or null)
- pickupRequested (boolean: wants pickup ride)
- dropoffRequested (boolean: wants drop-off ride)

**Business Rules:**
- Status changes as student progresses through journey
- currentRide is only set when student is assigned/in ride
- pickupRequested auto-set when student opens app before Sabha
- dropoffRequested only set when student clicks "Ready to Leave"

### 9.3 Driver Data Structure

**Fields:**
- id (unique identifier)
- userId (link to user account)
- name (full name)
- phone (contact number)
- currentCar (string: car ID or null) ← NO PERSISTENCE
- currentLocation (object):
  - lat (latitude)
  - lng (longitude)
- homeLocation (object):
  - lat (latitude)
  - lng (longitude)
- status (string: offline / ready_for_assignment / assigned / active_ride)
- activeRide (string: ride ID or null)
- ridesCompletedToday (integer: count)
- totalStudentsToday (integer: count)
- totalDistanceToday (number: kilometers)

**Business Rules:**
- currentCar is ALWAYS null when driver logs out
- stats reset to zero at start of each day (or manually)
- homeLocation used as end point for drop-off rides

### 9.4 Car Data Structure

**Fields:**
- id (unique identifier)
- model (string: e.g., "Honda City")
- color (string: e.g., "Blue")
- licensePlate (string: e.g., "DL01AB1234")
- capacity (integer: 2-10)
- status (string: available / in_use)
- assignedDriver (string: driver ID or null)

**Business Rules:**
- status = "available" means assignedDriver MUST be null
- status = "in_use" means assignedDriver MUST have a value
- capacity determines max students per ride

### 9.5 Ride Data Structure

**Fields:**
- id (unique identifier)
- eventDate (string: YYYY-MM-DD)
- driverId (string: driver ID)
- driverName (string: copied from driver)
- carId (string: car ID)
- carModel (string: copied from car)
- carColor (string: copied from car)
- carLicensePlate (string: copied from car)
- rideType (string: home-to-sabha / sabha-to-home)
- status (string: assigned / in_progress / completed)
- students (array of objects):
  - id (student ID)
  - name (student name)
  - location (lat/lng object)
  - picked (boolean: has been picked up/dropped off)
- route (array of objects):
  - type (string: start / pickup / dropoff / end)
  - location (lat/lng object)
  - name (string: description)
  - studentId (string: only for pickup/dropoff waypoints)
  - visited (boolean: driver has reached this point)
- estimatedDistance (number: total kilometers)
- estimatedTime (number: total minutes)
- startedAt (timestamp or null)
- completedAt (timestamp or null)

**Business Rules:**
- One ride record per driver per trip
- Students array length cannot exceed car capacity
- Route array is ordered (start, waypoints, end)
- All students must have picked=true before completion

### 9.6 Statistics Data Structure

**Fields (for one event date):**
- eventDate (string: YYYY-MM-DD)
- pickup (object):
  - totalStudents (integer)
  - completedRides (integer)
  - totalDrivers (integer)
  - students (array):
    - id, name (student info)
    - driverId, driverName (driver info)
    - carModel, carLicensePlate (car info)
- dropoff (object):
  - Same structure as pickup
- attendance (object):
  - both (integer: students who used both rides)
  - pickupOnly (integer: used only pickup)
  - dropoffOnly (integer: used only drop-off)

**Business Rules:**
- One statistics record per event date
- Updated automatically as rides complete
- Used for manager's statistics view and CSV export

### 9.7 System Data Structure

**Ride Context (system/rideContext):**
- rideType (string: home-to-sabha / sabha-to-home / null)
- displayText (string: UI-friendly description)
- timeContext (string: explanation)
- timestamp (timestamp: last update time)

**Business Rules:**
- Updated every minute by scheduled function
- Read by driver dashboard and assignment algorithm
- Single source of truth for current ride type

---

## 10. AUTOMATION RULES

### 10.1 What Happens Automatically (No User Action)

**Student Assignment:**
- When driver clicks "Assign Me"
- System automatically:
  - Finds all waiting students
  - Runs clustering algorithm
  - Picks best students for this driver
  - Creates assignment
  - Updates student statuses
  - Sends notifications
  - Shows preview to driver

**Ride Type Detection:**
- Every minute
- System automatically:
  - Checks current day and time
  - Determines if pickup, drop-off, or neither
  - Updates ride context in database
  - All dashboards reflect new context instantly

**Student Status Updates:**
- When ride starts: Students marked "in_ride"
- When ride completes: Students marked "at_sabha" or "home_safe"
- No manual manager intervention needed

**Statistics Updates:**
- When ride completes
- System automatically:
  - Adds student names to statistics record
  - Updates counters (total students, total rides)
  - Categorizes attendance (both/pickup only/drop-off only)

**Car Release:**
- When driver clicks "Done for Today"
- System automatically:
  - Changes car status to "available"
  - Clears car's assigned driver
  - Clears driver's current car (no persistence)

### 10.2 What Requires User Action

**Student Actions Required:**
- Edit their home location (if needed)
- Click "Ready to Leave" for drop-off

**Driver Actions Required:**
- Select car at start of session
- Click "Assign Me" to get students
- Click "Accept & Start" to begin ride
- Open Google Maps for navigation
- Click "Complete Ride" after finishing
- Choose "Continue" or "Done for Today"

**Manager Actions Required:**
- Manual assignment (only for unassigned students)
- Add/remove cars from fleet
- Download CSV reports

### 10.3 Background Tasks

**Scheduled Tasks:**
1. Ride type detection (every 1 minute)
2. Cleanup old completed rides (daily)
3. Reset daily driver stats (daily at midnight)
4. Send reminder notifications (optional)

**Real-time Listeners:**
- Student dashboard listens to student record and ride record
- Driver dashboard listens to available cars and ride context
- Manager dashboard listens to active rides and unassigned students
- All updates propagate instantly across devices

**GPS Tracking:**
- Driver's location tracked during active ride
- Used for waypoint visit detection
- Used for distance calculations
- Not shown live to students (privacy)

### 10.4 Error Handling Automation

**If Student Not Present at Pickup:**
- Driver can skip them (mark as absent)
- Student status changes to "missed_pickup"
- Student appears in manager's attention list
- Ride continues without that student

**If Driver Emergency:**
- Driver can cancel active ride
- System marks ride as "cancelled"
- All students in that ride go back to "waiting_for_assignment"
- Manager notified to reassign

**If No Drivers Available:**
- Students remain in "waiting_for_assignment"
- They appear in manager's unassigned list
- Manager can request additional drivers
- Manager can manually assign once drivers become available

**If GPS Fails:**
- Waypoint tracking disabled
- Driver can still complete ride manually
- System logs the discrepancy
- Does not block ride completion

---

## IMPLEMENTATION NOTES FOR AI AGENT

### What To Build

**Frontend (PWA):**
1. Student dashboard with three screens (waiting, assigned, in-ride)
2. Driver dashboard with five screens (car selection, assignment preview, active ride, completion, stats)
3. Manager dashboard with four screens (operations, manual assign, fleet, statistics)
4. Role switcher component (top-right dropdown)
5. Login/logout functionality
6. Notification permission request

**Backend (Firebase Cloud Functions):**
1. Ten cloud functions (listed in section 7.3)
2. One scheduled function for ride type detection
3. Notification sending logic
4. CSV generation logic

**Algorithms:**
1. K-means clustering (section 6.1)
2. Route optimization (section 6.2)
3. Ride type detection (section 6.3)
4. Waypoint tracking (section 6.4)
5. Haversine distance calculation

**Integrations:**
1. Firebase Auth setup
2. Firebase Realtime Database setup
3. Firebase Cloud Functions deployment
4. Google Maps URL construction
5. FCM push notifications

**Database Schema:**
1. Create seven main collections (section 9)
2. Set up security rules (role-based access)
3. Create indexes for queries

### What NOT To Build

**Do NOT implement:**
- Live tracking maps with moving pins
- ETA countdown timers
- Progress bars or indicators
- In-app navigation (use Google Maps)
- Chat or calling between users
- Rating/feedback forms
- Complex analytics dashboards
- Trend analysis charts
- Time slot selection UI
- Car persistence logic
- Manual ride type toggle

### Success Criteria

**Student Experience:**
- Opens app → sees waiting status → gets assigned → sees driver info → ride completes (4 steps, all automatic)

**Driver Experience:**
- Opens app → sees ride type auto-detected → selects car → clicks "Assign Me" → reviews assignment → accepts → opens Google Maps → completes → chooses continue or done (8 steps, minimal manual work)

**Manager Experience:**
- Opens app → sees all active rides → sees unassigned students (if any) → manually assigns (if needed) → manages fleet → exports CSV (5 capabilities, mostly monitoring)

**System Performance:**
- 90% of students get auto-assigned without manager intervention
- Assignment happens within 30 seconds of driver clicking "Assign Me"
- Zero manual coordination needed for standard scenarios

---

**END OF SPECIFICATION**

This document contains everything needed to build the system. No code provided - only concepts, flows, algorithms, and business logic. AI agent should implement using appropriate frameworks and best practices.
