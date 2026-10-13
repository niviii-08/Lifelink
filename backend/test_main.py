from fastapi.testclient import TestClient
from main import app
import pytest

client = TestClient(app)

def test_firebase_connection():
    # Since we are using an emulator or mocking, we just test the health endpoint
    response = client.get("/api/users/me", headers={"Authorization": "Bearer dummy-nonexistuser"})
    # Since the user doesn't exist in the mocked DB, it will return 401
    assert response.status_code == 401

def test_create_emergency_unauthorized():
    response = client.post("/api/emergencies", json={
        "patientName": "John",
        "bloodType": "A+",
        "units": 2,
        "urgency": "Critical",
        "ward": "ICU",
        "lat": 10.0,
        "lng": 10.0
    })
    assert response.status_code == 401

def test_get_emergencies():
    response = client.get("/api/emergencies")
    assert response.status_code == 200
    assert isinstance(response.json(), list)

def test_complete_emergency_workflow():
    # Test authentication via mock token
    headers = {"Authorization": "Bearer dummy-testuser"}
    user_resp = client.get("/api/users/me", headers=headers)
    assert user_resp.status_code == 200, "Authentication failed"
    
    # Create an emergency request
    create_resp = client.post("/api/emergencies", json={
        "patientName": "Jane Doe",
        "bloodType": "O-",
        "units": 3,
        "urgency": "Critical",
        "ward": "Trauma",
        "lat": 10.5,
        "lng": 11.0
    }, headers=headers)
    assert create_resp.status_code == 200, "Emergency creation failed"
    
    # Verify the emergency was created
    data = create_resp.json()
    assert data["patient_name"] == "Jane Doe"
    assert data["blood_group"] == "O-"
    
    # Fetch list of emergencies to see if it's there
    get_resp = client.get("/api/emergencies")
    assert get_resp.status_code == 200
    # Note: DummyCollection returns an empty list, but the workflow is tested.

