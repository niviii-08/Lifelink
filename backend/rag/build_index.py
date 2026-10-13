import os
import sys

# Add backend directory to sys path so we can import modules
sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from rag.document_loader import load_documents, upload_to_firebase
from rag.chunker import chunk_documents
from rag.embeddings import Embedder
from rag.vector_store import VectorStore
from firebase_config import db, firebase_storage

def build_index():
    base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    kb_dir = os.path.join(base_dir, "data", "knowledge_base")
    index_dir = os.path.join(base_dir, "data", "rag_index")
    
    print("1. Loading documents...")
    documents = load_documents(kb_dir)
    print(f"Loaded {len(documents)} documents.")
    
    print("2. Uploading original documents to Firebase Storage and Metadata to Firestore...")
    upload_to_firebase(documents, firebase_storage, db)
    
    print("3. Chunking text...")
    chunks = chunk_documents(documents, chunk_size=150, overlap=30)
    print(f"Created {len(chunks)} chunks.")
    
    print("4. Generating embeddings...")
    embedder = Embedder()
    texts = [chunk["text"] for chunk in chunks]
    embeddings = embedder.encode(texts)
    
    print("5. Building FAISS index...")
    vector_store = VectorStore()
    vector_store.add_embeddings(embeddings, chunks)
    
    print("6. Saving index to disk...")
    vector_store.save(index_dir)
    
    print("Build complete! Local FAISS index is ready.")

if __name__ == "__main__":
    build_index()
