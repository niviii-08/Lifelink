# Firebase Schema Mapping

This document maps the existing SQLite tables to the new Cloud Firestore collections.

## Core Entities

### 1. Users
**SQLite Table:** `users`, `donor_profiles`, `hospital_profiles`, `blood_bank_profiles`
**Firestore Collection:** `users`
**Document ID:** Firebase Auth UID
**Structure:**
```json
{
  "name": "string",
  "email": "string",
  "phone": "string",
  "role": "Donor | Patient | Hospital | Blood Bank | Admin",
  "telegram_chat_id": "string (optional)",
  "passport_id": "string",
  "status": "Active | Inactive",
  "total_donations": "number",
  "xp": "number",
  "location": {
    "label": "string",
    "address": "string",
    "city": "string",
    "lat": "number",
    "lng": "number"
  },
  "created_at": "timestamp",
  "updated_at": "timestamp",
  
  // Role-specific nested maps (instead of separate tables)
  "donor_profile": {
    "blood_group": "string",
    "availability_status": "string",
    "last_donation_date": "timestamp",
    "next_eligible_date": "timestamp"
  },
  "hospital_profile": {
    "license_number": "string",
    "quota_used": "number",
    "quota_limit": "number",
    "active_emergencies": "number",
    "verification_status": "string"
  },
  "blood_bank_profile": {
    "license_number": "string",
    "active_transfers": "number",
    "verification_status": "string"
  }
}
```

### 2. Blood Inventory
**SQLite Table:** `blood_inventory`
**Firestore Collection:** `blood_inventory`
**Document ID:** Auto-generated or `blood_bank_id_blood_group`
**Structure:**
```json
{
  "blood_bank_id": "reference to users",
  "blood_group": "string",
  "units": "number",
  "updated_at": "timestamp"
}
```

### 3. Emergencies
**SQLite Table:** `emergencies`
**Firestore Collection:** `emergencies`
**Document ID:** Auto-generated
**Structure:**
```json
{
  "patient_name": "string",
  "blood_group": "string",
  "hospital_id": "reference to users",
  "hospital_name": "string",
  "location": {
    "lat": "number",
    "lng": "number"
  },
  "units_needed": "number",
  "urgency": "Critical | Urgent | Normal",
  "ward": "string",
  "status": "Pending | Searching | Donors Notified | Donor Responded | Blood Reserved | Fulfilled | Cancelled | Expired",
  "alerts_sent": "number",
  "expires_at": "timestamp",
  "created_at": "timestamp",
  "updated_at": "timestamp"
}
```

### 4. Emergency Status History
**SQLite Table:** `emergency_status_history`
**Firestore Collection:** `emergencies/{emergency_id}/history` (Subcollection)
**Document ID:** Auto-generated
**Structure:**
```json
{
  "status": "string",
  "notes": "string",
  "created_at": "timestamp"
}
```

### 5. Donor Matches
**SQLite Table:** `donor_matches`
**Firestore Collection:** `emergencies/{emergency_id}/matches` (Subcollection)
**Document ID:** `donor_id`
**Structure:**
```json
{
  "donor_id": "reference to users",
  "compatibility_score": "number",
  "distance_km": "number",
  "reliability_score": "number",
  "response_score": "number",
  "status": "Suggested | Notified | Accepted | Declined | Reserved | Donated",
  "updated_at": "timestamp"
}
```

### 6. Camps & Registrations
**SQLite Tables:** `camps`, `camp_registrations`
**Firestore Collections:** `camps`, `camps/{camp_id}/registrations`
**Camps Structure:**
```json
{
  "organizer_name": "string",
  "contact_phone": "string",
  "contact_email": "string",
  "date": "timestamp",
  "start_time": "string",
  "end_time": "string",
  "location": {
    "label": "string",
    "address": "string",
    "city": "string",
    "lat": "number",
    "lng": "number"
  },
  "verification_status": "string",
  "created_at": "timestamp"
}
```
**Registrations Structure:**
```json
{
  "donor_id": "reference to users",
  "status": "Registered | Attended | Cancelled",
  "registered_at": "timestamp"
}
```

### 7. Notifications
**SQLite Tables:** `notifications`, `notification_preferences`
**Firestore Collections:** `users/{user_id}/notifications`, `users/{user_id}/notification_preferences`
**Notifications Structure:**
```json
{
  "type": "string",
  "title": "string",
  "message": "string",
  "related_entity_id": "string",
  "related_entity_type": "string",
  "is_read": "boolean",
  "created_at": "timestamp"
}
```
**Preferences Structure:**
```json
{
  "email_alerts": "boolean",
  "telegram_alerts": "boolean",
  "push_alerts": "boolean"
}
```

### 8. Analytics & NLP (Future Phases)
**Firestore Collections:** `analytics_events`, `chat_sessions`, `chat_messages`, `nlp_requests`, `nlp_predictions`, `knowledge_documents`

## Security Rules Strategy
1. **Users:** Users can read/write their own profile. Admins can read/write all. Hospitals/Blood Banks can read public donor info when there's an active match.
2. **Emergencies:** Anyone authenticated can read. Hospitals/Patients can create. 
3. **Blood Inventory:** Publicly readable. Writable only by the respective Blood Bank or Admin.
4. **Camps:** Publicly readable. Writable by organizer or Admin.
5. **Notifications:** Users can only read/write their own subcollections.
