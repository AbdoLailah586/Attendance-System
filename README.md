# Smart Geolocation Attendance & Multi-Branch Shift Tracking System 🏪📍

A production-ready, mobile-first web application designed for retail shops, multi-branch stores, and field businesses to track employee attendance, branch switching, and shift punctuality in real-time via high-precision 60-second GPS geofencing.

Built with **Next.js 16 (App Router)**, **TypeScript**, **PostgreSQL (Neon)**, **Vanilla Modern CSS (Light Theme)**, and **Leaflet.js**, configured for 24/7 cloud persistence on **Vercel** or **Railway**.

---

## 🚀 Key Features

### 1. 60-Second Geofencing Engine
- **Continuous Real-Time Tracking**: Employee devices emit a geolocation heartbeat every 60 seconds with GPS coordinate accuracy logging.
- **Multi-Branch Proximity**:
  - 🟢 **Branch 1 (Primary Store)**
  - 🔵 **Branch 2 (Secondary Store)**
  - 🟠 **Outside Stores (Out of Geofence / Break)**
  - ⚪ **Offline (Disconnected / Inactive)**
- **Haversine Distance Algorithm**: Dynamically computes exact distances in meters between employee coordinates and configurable store centers.
- **Audio & Haptic Feedback**: Native Web Audio API sound chimes trigger when transitioning between branches or stepping outside.

### 2. Administrator Operations Hub
- **Live Employee Radar & Map**:
  - Interactive Leaflet map displaying circular geofence boundaries for each branch.
  - Real-time location markers for on-duty staff with status badges and meter distances.
  - 15-second automatic radar refresh.
- **Punctuality & Shift Analytics**:
  - Total presence duration formatted in human-readable **Hours and Minutes** (e.g. `7 hours and 45 minutes`).
  - Branch breakdown: Time spent in Branch 1 vs Branch 2 vs Outside.
  - First arrival time (*"وصل إمتى"*) and last departure time (*"مشى إمتى"*).
  - Punctuality assessment against shift schedules:
    - 🟢 **Early Arrival**: Clocked in before shift start (with exact minutes early).
    - 🟢 **On-Time**: Arrived within the designated grace period window (e.g. 10:00 - 10:30 AM).
    - 🔴 **Late Arrival**: Arrived past grace period (with exact late duration highlighted).
    - ⚪ **Absent**: No presence detected during shift.
  - Chronological movement timeline visualizing daily branch transitions and break intervals.
  - One-click **Excel / CSV Export** for payroll and HR.
- **Geofence & Shift Configuration**:
  - Set custom store names, GPS coordinates (Latitude/Longitude), and radius in meters.
  - *"Use My Current Location"* GPS button to grab store coordinates instantly on-site.
  - Configurable shift start time, shift end time, and grace period minutes.
- **Staff Credential Management**:
  - Create, view, update, and deactivate employee accounts.
  - One-click *"Copy Login Info"* button to send credentials to employees via WhatsApp or SMS.
  - Quick-seed demo generator to populate realistic test scenarios.

### 3. Employee Mobile Experience (PWA)
- **Light & Calm Modern Theme**: Minimalist aesthetic with high-contrast soft palettes and Google Fonts (Cairo & Plus Jakarta Sans).
- **Live Branch Status Badge**: Clear real-time indicator of current store location.
- **60-Second Countdown Meter**: Visual progress bar showing time until next automatic sync.
- **Manual Clock In / Clock Out**: Explicit duty controls and on-demand location refresh.
- **Personal Daily Summary**: Live feedback on total hours clocked today and branch time breakdown.
- **Integrated Test Simulation**: One-click branch simulation buttons for testing transitions without moving physically.

---

## 🛠️ Technology Stack

| Layer | Technology | Rationale |
| :--- | :--- | :--- |
| **Framework** | Next.js 16.3 (App Router) | Full-stack serverless capabilities, SEO, fast Turbopack builds, native Vercel hosting |
| **Language** | TypeScript | Strong typing for geofence models, database schemas, and API contracts |
| **Database** | Neon PostgreSQL (Serverless) | Cloud-hosted PostgreSQL with connection pooling, 24/7 persistence, works across lambdas |
| **Styling** | Vanilla CSS Tokens & Modules | Lightweight, clean light-mode design system with zero build overhead and Cairo font |
| **Mapping** | Leaflet.js & OpenStreetMap | Interactive geofence circles and live markers without expensive third-party map API keys |
| **Audio** | HTML5 Web Audio API | Synthesizer-based auditory feedback without external audio asset dependencies |
| **Auth** | Custom HMAC/JWT + Secure Cookies | Zero-dependency, lightweight authentication matching Edge and Node runtime |

---

## 🗄️ Database Architecture

```mermaid
erDiagram
    SETTINGS {
        string id PK
        string branch1_name
        float branch1_lat
        float branch1_lng
        int branch1_radius
        string branch2_name
        float branch2_lat
        float branch2_lng
        int branch2_radius
        string shift_start_time
        string shift_end_time
        int grace_period_mins
        int ping_interval_secs
    }

    USERS {
        serial id PK
        string username UK
        string password
        string name
        string phone
        string role
        string shift_start
        string shift_end
        boolean is_active
        timestamp created_at
    }

    ATTENDANCE_LOGS {
        serial id PK
        int user_id FK
        timestamp timestamp
        string branch_id
        float lat
        float lng
        float accuracy
        float distance_branch1
        float distance_branch2
        string event_type
    }

    USERS ||--o{ ATTENDANCE_LOGS : "logs"
```

---

## 🔑 Default Seed Credentials

| Role | Username | Password | Notes |
| :--- | :--- | :--- | :--- |
| **Admin** | `admin` | `admin123` | Full administrative control, radar, settings & reports |
| **Employee 1** | `emp1` | `123456` | Ahmed Mahmoud (Pre-configured sample employee) |
| **Employee 2** | `emp2` | `123456` | Mohamed Ali (Pre-configured sample employee) |
| **Employee 3** | `emp3` | `123456` | Karim Hassan (Pre-configured sample employee) |
| **Employee 4** | `emp4` | `123456` | Youssef Ibrahim (Pre-configured sample employee) |
| **Employee 5** | `emp5` | `123456` | Omar Farouk (Pre-configured sample employee) |

*Quick-login helper buttons are provided on the login page for instantaneous 1-click testing.*

---

## 💻 Local Installation & Development

### Prerequisites
- Node.js 18+ (tested on Node v24)
- npm or yarn

```bash
# 1. Clone repository
git clone https://github.com/AbdoLailah586/Attendance-System.git
cd Attendance-System

# 2. Install dependencies
npm install

# 3. Configure environment variables (.env)
cp .env.example .env
# (The .env file is pre-populated with the live cloud Neon PostgreSQL connection string)

# 4. Initialize database schema & seed data
node --env-file=.env scripts/init-db.mjs

# 5. Start development server
npm run dev

# 6. Or build for production
npm run build
npm run start -p 3000
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## 🌐 Deploy to Vercel (Recommended)

1. Fork or push this repository to your GitHub account.
2. Go to [Vercel Dashboard](https://vercel.com/new) and import the repository.
3. In **Environment Variables**, set:
   ```env
   DATABASE_URL=postgresql://neondb_owner:npg_9MyClUOc3sKe@ep-sweet-glitter-b1ma20y9-pooler.c-5.eu-central-1.aws.neon.tech/attendance_db?channel_binding=require&sslmode=require
   JWT_SECRET=attendance-secret-key-super-secure-token-2026
   ```
4. Click **Deploy**. Vercel will automatically build and publish the app with global Edge and Serverless API functions.

---

## 🚂 Deploy to Railway

1. Open [Railway.app](https://railway.app) and create a **New Project** from GitHub Repo.
2. Add the environment variables (`DATABASE_URL` and `JWT_SECRET`).
3. Railway automatically detects Next.js, executes `npm run build`, and starts the server on the assigned port.

---

## 📡 REST API Reference

| Endpoint | Method | Role | Description |
| :--- | :--- | :--- | :--- |
| `/api/auth/login` | `POST` | Public | Authenticates user and returns session JWT |
| `/api/auth/me` | `GET` | Authenticated | Retrieves current session identity |
| `/api/auth/logout` | `POST` | Authenticated | Clears authentication cookie |
| `/api/attendance/ping` | `POST` | Employee | Ingests 60-second GPS heartbeat and verifies geofence |
| `/api/attendance/live` | `GET` | Admin / Auth | Returns real-time radar data, distance metrics, and online status |
| `/api/attendance/report` | `GET` | Admin / Auth | Computes hours & minutes breakdown, punctuality, and timeline |
| `/api/attendance/seed-demo` | `POST` | Admin | Seeds realistic sample attendance logs for instant demo |
| `/api/settings` | `GET`, `PUT` | Admin | Fetches and updates branch geofences and shift configuration |
| `/api/users` | `GET`, `POST`, `PUT`, `DELETE` | Admin | CRUD operations for employee accounts |

---

## 📋 Developer Production Enhancements Roadmap

For teams building on top of this architecture, recommended future additions include:
1. **Background GPS on Mobile Lock**: Wrap with **Capacitor** or **React Native / Flutter** to enable native background geolocation service when the device screen is off.
2. **Wi-Fi SSID / BSSID Verification**: Validate the shop's local Wi-Fi router BSSID alongside GPS coordinates to prevent GPS spoofing.
3. **Automated WhatsApp / Telegram Notifications**: Dispatch automatic alerts to the store manager when an employee arrives late or leaves before shift end.
4. **PDF Shift Summaries**: Direct PDF export for printing official monthly attendance timesheets.
5. **Offline Queueing (IndexedDB)**: Cache pings locally in browser storage when network connection drops, syncing them once back online.

---

## 📄 License
This project is open-source under the MIT License.
