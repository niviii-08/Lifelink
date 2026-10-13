import os
import firebase_admin
from firebase_admin import credentials, firestore, auth
from dotenv import load_dotenv

load_dotenv()

def initialize_firebase():
    if not firebase_admin._apps:
        # Use emulator if configured, otherwise require credentials
        if os.getenv("FIRESTORE_EMULATOR_HOST") and os.getenv("FIREBASE_AUTH_EMULATOR_HOST"):
            # Dummy credentials for emulator
            cred = credentials.Certificate({
                "type": "service_account",
                "project_id": "lifelink-demo",
                "private_key_id": "dummy",
                "private_key": "-----BEGIN PRIVATE KEY-----\ndummy\n-----END PRIVATE KEY-----\n",
                "client_email": "dummy@dummy.iam.gserviceaccount.com",
                "client_id": "dummy",
                "auth_uri": "https://accounts.google.com/o/oauth2/auth",
                "token_uri": "https://oauth2.googleapis.com/token",
                "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
                "client_x509_cert_url": "https://www.googleapis.com/robot/v1/metadata/x509/dummy%40dummy.iam.gserviceaccount.com"
            })
        else:
            cred_path = os.getenv("FIREBASE_CREDENTIALS_PATH")
            if cred_path and os.path.exists(cred_path):
                cred = credentials.Certificate(cred_path)
            else:
                raise ValueError("FIREBASE_CREDENTIALS_PATH not set and emulators not configured.")
        
        firebase_admin.initialize_app(cred, {
            'storageBucket': 'lifelink-73ad1.appspot.com'
        })
    
    db = firestore.client()
    from firebase_admin import storage
    return db, auth, storage

try:
    db, firebase_auth, firebase_storage = initialize_firebase()
except ValueError as e:
    print(f"Firebase not initialized: {e}")
    db, firebase_auth, firebase_storage = None, None, None
