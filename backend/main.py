from fastapi import FastAPI, Depends, HTTPException, Header, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
from firebase_service import user_service, emergency_service, inventory_service, camp_service
from firebase_config import firebase_auth, db
from firebase_admin import firestore
from datetime import datetime
import uuid
import sys
import os

# Add the current directory to sys.path so we can import nlp
sys.path.append(os.path.dirname(os.path.abspath(__file__)))
from nlp.pipeline import get_nlp_pipeline

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def get_current_user(authorization: str = Header(None)):
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Authentication required.")
    token = authorization.split("Bearer ")[1]
    try:
        if token.startswith("dummy-"):
            uid = token.replace("dummy-", "")
            user = user_service.get_by_id(uid)
            if not user:
                # Mock user for testing
                if uid == "testuser":
                    return {"id": "testuser", "name": "Test User", "role": "Hospital"}
                raise HTTPException(status_code=401, detail="User not found in DB.")
            return user
        elif firebase_auth:
            decoded = firebase_auth.verify_id_token(token)
            uid = decoded["uid"]
            user = user_service.get_by_id(uid)
            if not user:
                raise HTTPException(status_code=401, detail="User not found in DB.")
            return user
        else:
            raise ValueError("Firebase auth not initialized")
    except Exception as e:
        raise HTTPException(status_code=401, detail=f"Invalid token: {str(e)}")

@app.get("/api/users/me")
def get_me(current_user: dict = Depends(get_current_user)):
    return current_user

# --- Emergencies ---
class EmergencyCreate(BaseModel):
    patientName: str
    bloodType: str
    units: int
    urgency: str
    ward: str
    lat: float
    lng: float
    hospitalId: Optional[str] = None
    hospital: Optional[str] = None

@app.post("/api/emergencies")
def create_emergency(req: EmergencyCreate, current_user: dict = Depends(get_current_user)):
    doc_id = str(uuid.uuid4())
    data = {
        "patient_name": req.patientName,
        "blood_group": req.bloodType,
        "units_needed": req.units,
        "urgency": req.urgency,
        "ward": req.ward,
        "lat": req.lat,
        "lng": req.lng,
        "hospital_id": current_user["id"],
        "hospital_name": current_user.get("name", ""),
        "status": "Pending",
        "alerts_sent": 0,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat()
    }
    emergency_service.create(doc_id, data)
    return data

@app.get("/api/emergencies")
def get_emergencies():
    return emergency_service.get_active()

@app.get("/api/dashboard/donor")
def donor_dashboard(current_user: dict = Depends(get_current_user)):
    # Mock dashboard data for now
    return {
        "xp": current_user.get("xp", 0),
        "totalDonations": current_user.get("total_donations", 0),
        "nextEligibleDate": "2026-10-01",
        "recentMatches": []
    }

class NLPRequest(BaseModel):
    text: str

@app.post("/api/nlp/parse")
def parse_text(request: NLPRequest):
    pipeline = get_nlp_pipeline()
    return pipeline.process(request.text)

class RAGRequest(BaseModel):
    question: str

@app.post("/api/rag/query")
def rag_query(request: RAGRequest):
    index_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rag_index")
    from rag.pipeline import get_rag_pipeline
    pipeline = get_rag_pipeline(index_dir)
    return pipeline.query(request.question)

class ChatMessage(BaseModel):
    conversation_id: str
    text: str

@app.post("/api/chat/message")
def chat_message(request: ChatMessage):
    # Process NLP
    nlp_pipeline = get_nlp_pipeline()
    nlp_result = nlp_pipeline.process(request.text)
    
    intent = nlp_result.get("intent", "general")
    
    # Store user message
    db.collection("chats").document(request.conversation_id).collection("messages").add({
        "sender": "user",
        "text": request.text,
        "timestamp": firestore.SERVER_TIMESTAMP
    })
    
    response_data = {
        "intent": intent,
        "confidence": nlp_result.get("confidence", 0.0)
    }
    
    if intent == "emergency_request":
        response_data["type"] = "emergency_confirm"
        bg = nlp_result.get('blood_group', 'Unknown')
        qty = nlp_result.get('quantity', 'Unknown')
        hosp = nlp_result.get('hospital', 'Unknown')
        response_data["reply"] = f"I detected an emergency request. Blood: {bg}, Units: {qty}, Hospital: {hosp}. Do you want to create this request?"
        response_data["urgency"] = nlp_result.get("urgency", "Normal")
        
        # Attach raw parsed data for the frontend to auto-fill
        response_data["parsed_data"] = {
            "blood_group": bg,
            "quantity": qty,
            "hospital": hosp,
            "urgency": response_data["urgency"]
        }
    elif intent in ["general", "unknown"]:
        response_data["type"] = "general"
        response_data["reply"] = "I am LifeLink AI. I can help with blood donation info or emergency requests. Please ask a specific question!"
    else:
        # RAG query
        index_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data", "rag_index")
        from rag.pipeline import get_rag_pipeline
        rag_pipeline = get_rag_pipeline(index_dir)
        rag_res = rag_pipeline.query(request.text)
        
        response_data["type"] = "rag"
        response_data["reply"] = rag_res["answer"]
        response_data["source"] = rag_res["document_metadata"]
        
    # Store bot message
    db.collection("chats").document(request.conversation_id).collection("messages").add({
        "sender": "bot",
        "text": response_data["reply"],
        "metadata": response_data,
        "timestamp": firestore.SERVER_TIMESTAMP
    })
    
    return response_data
