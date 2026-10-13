from google.cloud import firestore
from firebase_admin import auth
from typing import Dict, Any, List, Optional
from firebase_config import db

class FirestoreRepository:
    def __init__(self, collection_name: str):
        self.collection_name = collection_name
        
    @property
    def collection(self):
        from firebase_config import db
        if not db:
            # Provide a dummy collection for testing without Firebase
            class DummyCollection:
                def stream(self): return []
                def where(self, filter=None, **kwargs): return self
                def document(self, id):
                    class DummyDoc:
                        def get(self):
                            class DummySnap:
                                exists = False
                            return DummySnap()
                        def set(self, data): pass
                        def update(self, data): pass
                        def delete(self): pass
                    return DummyDoc()
            return DummyCollection()
        return db.collection(self.collection_name)
    
    def get_all(self) -> List[Dict[str, Any]]:
        docs = self.collection.stream()
        return [{**doc.to_dict(), "id": doc.id} for doc in docs]
    
    def get_by_id(self, doc_id: str) -> Optional[Dict[str, Any]]:
        doc = self.collection.document(doc_id).get()
        if doc.exists:
            return {**doc.to_dict(), "id": doc.id}
        return None
    
    def create(self, doc_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        self.collection.document(doc_id).set(data)
        return {**data, "id": doc_id}
    
    def update(self, doc_id: str, data: Dict[str, Any]) -> Dict[str, Any]:
        self.collection.document(doc_id).update(data)
        return {**data, "id": doc_id}
    
    def delete(self, doc_id: str) -> None:
        self.collection.document(doc_id).delete()

class UserService(FirestoreRepository):
    def __init__(self):
        super().__init__('users')
    
    def get_by_role(self, role: str) -> List[Dict[str, Any]]:
        docs = self.collection.where(filter=firestore.FieldFilter("role", "==", role)).stream()
        return [{**doc.to_dict(), "id": doc.id} for doc in docs]

class EmergencyService(FirestoreRepository):
    def __init__(self):
        super().__init__('emergencies')
        
    def get_active(self) -> List[Dict[str, Any]]:
        docs = self.collection.where(filter=firestore.FieldFilter("status", "not-in", ["Fulfilled", "Cancelled", "Expired"])).stream()
        return [{**doc.to_dict(), "id": doc.id} for doc in docs]

class BloodInventoryService(FirestoreRepository):
    def __init__(self):
        super().__init__('blood_inventory')
        
    def get_by_bank(self, bank_id: str) -> List[Dict[str, Any]]:
        docs = self.collection.where(filter=firestore.FieldFilter("blood_bank_id", "==", bank_id)).stream()
        return [{**doc.to_dict(), "id": doc.id} for doc in docs]

class CampService(FirestoreRepository):
    def __init__(self):
        super().__init__('camps')

# Instantiate services
user_service = UserService()
emergency_service = EmergencyService()
inventory_service = BloodInventoryService()
camp_service = CampService()
