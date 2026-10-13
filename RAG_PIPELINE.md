# LifeLink RAG Pipeline Architecture

This document describes the Retrieval-Augmented Generation (RAG) pipeline built for the LifeLink knowledge base.

## Components

The system is built entirely locally (with the exception of Firebase sync) and handles end-to-end question answering grounded ONLY in verified medical guidelines.

### 1. Document Loading and Sync (`backend/rag/document_loader.py`)
- Reads raw Markdown/Text knowledge base documents from `backend/data/knowledge_base`.
- Uploads the original documents into the `lifelink-73ad1` Firebase Storage bucket under `knowledge_base/`.
- Registers metadata (filename, bucket path, timestamp) as documents in the Firestore `kb_metadata` collection.
- Includes a graceful fallback if the Firebase Storage bucket isn't fully provisioned in the user's Google Cloud console, allowing local RAG to still function perfectly.

### 2. Chunking (`backend/rag/chunker.py`)
- Employs a sliding-window overlapping chunking strategy.
- Splits long documents into manageable sizes (150 words per chunk with a 30-word overlap) to ensure that the LLM receives highly relevant context without exceeding sequence limits.

### 3. Embeddings (`backend/rag/embeddings.py`)
- Utilizes `sentence-transformers` locally.
- Encodes chunks into dense 384-dimensional vectors using `all-MiniLM-L6-v2`. This model is chosen for its excellent balance of speed and semantic representation capability.

### 4. Vector Store (`backend/rag/vector_store.py`)
- Powered by `faiss-cpu`.
- Uses an `IndexFlatL2` index for exact nearest-neighbor search.
- The index and raw chunk data are serialized and saved to disk in `backend/data/rag_index/`.
- A dedicated rebuild script (`backend/rag/build_index.py`) allows developers/admins to trigger an explicit re-index when new knowledge base files are added.

### 5. LLM Generation (`backend/rag/generator.py`)
- Uses `google/flan-t5-small` loaded directly via `AutoModelForSeq2SeqLM` running completely locally.
- Strictly prompted to ground its answers ONLY in the provided retrieved context chunks, mitigating hallucination risks critical in healthcare applications.

## API Endpoint
**Endpoint**: `POST /api/rag/query`

**Payload**:
```json
{
    "question": "What is the age requirement for donating blood?"
}
```

**Response Structure**:
```json
{
    "answer": "You must be between 18 and 65 years old.",
    "retrieved_chunks": ["...raw text..."],
    "document_metadata": [{"filename": "eligibility.txt"}],
    "similarity_scores": [1.1866]
}
```
The response design explicitly includes `document_metadata` to allow the frontend chatbot to provide explicit source attribution to the user.

## Operations
To rebuild the index after adding new text files to `backend/data/knowledge_base`:
```bash
python backend/rag/build_index.py
```
