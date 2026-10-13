import os
import uuid
from firebase_admin import firestore

def load_documents(directory: str):
    """Loads all text files from a directory."""
    documents = []
    if not os.path.exists(directory):
        print(f"Directory {directory} not found.")
        return documents
        
    for filename in os.listdir(directory):
        if filename.endswith(".txt") or filename.endswith(".md"):
            filepath = os.path.join(directory, filename)
            with open(filepath, 'r', encoding='utf-8') as f:
                content = f.read()
                documents.append({
                    "id": str(uuid.uuid4()),
                    "filename": filename,
                    "content": content
                })
    return documents

def upload_to_firebase(documents, storage_client, db_client):
    """Uploads documents to Firebase Storage and metadata to Firestore."""
    if not storage_client or not db_client:
        print("Firebase clients not initialized. Skipping upload.")
        return
        
    bucket = storage_client.bucket()
    
    for doc in documents:
        try:
            # Upload to Storage
            blob_path = f"knowledge_base/{doc['filename']}"
            blob = bucket.blob(blob_path)
            blob.upload_from_string(doc['content'], content_type='text/plain')
            
            # Save Metadata to Firestore
            metadata = {
                "filename": doc['filename'],
                "storage_path": blob_path,
                "uploaded_at": firestore.SERVER_TIMESTAMP
            }
            
            db_client.collection('kb_metadata').document(doc['id']).set(metadata)
            print(f"Uploaded {doc['filename']} to Firebase.")
        except Exception as e:
            print(f"Warning: Failed to upload {doc['filename']} to Firebase Storage (Bucket might not be provisioned). Error: {e}")
