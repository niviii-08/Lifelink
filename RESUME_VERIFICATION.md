# Resume Verification Report

This document contains a strict verification of the technologies and features implemented in the LifeLink repository. It maps claims directly to the actual working code to determine what can truthfully be placed on a resume.

## Technology Stack Verification

| Technology | Evidence/File | Status | How it is used |
| :--- | :--- | :--- | :--- |
| **Python** | `backend/main.py`, `backend/**/*.py` | IMPLEMENTED | Core language for the backend API, AI pipelines, data processing, and evaluation scripts. |
| **FastAPI** | `backend/main.py` | IMPLEMENTED | Powers the backend web framework and REST API endpoints (e.g., `/api/nlp/parse`, `/api/chat/message`, RAG endpoint). |
| **REST APIs** | `backend/main.py` | IMPLEMENTED | Application utilizes standard REST architectural patterns for communication between the React frontend and FastAPI backend. |
| **Firebase** | `backend/firebase_config.py`, `client/src/firebase.ts` | IMPLEMENTED | Provides overarching authentication and acts as the umbrella for the cloud ecosystem (Auth, Storage, Firestore). |
| **Firestore** | `backend/firebase_config.py`, `client/src/api.ts` | IMPLEMENTED | Used as the primary NoSQL database for storing user profiles, emergency requests, chat histories, and RAG document metadata. |
| **Firebase Storage** | `backend/rag/document_loader.py` | IMPLEMENTED | Handles the storage of raw knowledge base texts/documents before they are embedded into the FAISS vector database. |
| **React** | `client/src/components/`, `client/src/pages/` | IMPLEMENTED | Powers the entire frontend user interface, including interactive maps, dashboards, and the AI chatbot. |
| **TypeScript** | `client/src/**/*.ts`, `client/src/**/*.tsx` | IMPLEMENTED | Provides static typing and compilation for the React frontend, ensuring robust API integration and state management. |
| **PyTorch** | `backend/nlp/`, `backend/training/train_lora.py` | IMPLEMENTED | The underlying deep learning framework executing inference and parameter-efficient fine-tuning for all local AI models. |
| **Hugging Face Transformers** | `backend/nlp/`, `backend/rag/` | IMPLEMENTED | Drives local inference and fine-tuning for models (e.g., `distilbert-base-uncased`, `google/flan-t5-small`) using `pipeline`, `AutoModelForSequenceClassification`, etc. |
| **LoRA** | `backend/training/train_lora.py` | IMPLEMENTED | Low-Rank Adaptation technique used to fine-tune the intent classification model efficiently. |
| **PEFT** | `backend/training/train_lora.py` | IMPLEMENTED | Hugging Face's Parameter-Efficient Fine-Tuning library used to inject and train LoRA adapters onto the base Transformer model. |
| **RAG** | `backend/rag/pipeline.py` | IMPLEMENTED | Retrieval-Augmented Generation pipeline implemented entirely locally to answer medical queries using verified guidelines. |
| **FAISS** | `backend/rag/vector_store.py` | IMPLEMENTED | Facebook AI Similarity Search provides the dense vector index (`IndexFlatL2`) to rapidly retrieve overlapping text chunks for the RAG pipeline. |
| **LLM** | `backend/rag/generator.py` | IMPLEMENTED | Local execution of the `google/flan-t5-small` Large Language Model strictly prompted to generate answers grounded in retrieved FAISS chunks. |
| **OpenRouter** | *None* | NOT IMPLEMENTED | No API calls or configurations for OpenRouter exist in the codebase. |
| **GPT-4o** | *None* | NOT IMPLEMENTED | No API calls to OpenAI or GPT-4o exist; the project relies entirely on local open-source models. |
| **scikit-learn** | `backend/evaluation/evaluate_lora.py`, `evaluate.py` | IMPLEMENTED | Computes robust statistical evaluation metrics (accuracy, precision, recall, F1 score, confusion matrix) for the AI models. |
| **Pandas** | `backend/training/train_lora.py`, `evaluate.py` | IMPLEMENTED | Handles data ingestion, manipulation, and CSV parsing for the NLP training datasets and evaluation benchmarks. |
| **NumPy** | `backend/rag/vector_store.py` | IMPLEMENTED | Facilitates high-performance multi-dimensional array operations, converting model embeddings for ingestion into the FAISS index. |
| **Git/GitHub** | *None* | NOT IMPLEMENTED | The repository lacks a `.git` tracking directory and is functioning as a standalone local directory structure. |

---

## Feature Verification

1. **NLP model**: ✅ IMPLEMENTED (`backend/nlp/pipeline.py` orchestrates multiple PyTorch/HF pipelines)
2. **Intent classifier**: ✅ IMPLEMENTED (`backend/nlp/intent_classifier.py` runs zero-shot or LoRA-trained classification)
3. **NER**: ✅ IMPLEMENTED (`backend/nlp/ner.py` extracts blood groups, quantities, hospitals, and locations using token classification)
4. **Urgency classifier**: ✅ IMPLEMENTED (`backend/nlp/urgency.py` infers logical urgency from raw text)
5. **LoRA training**: ✅ IMPLEMENTED (`backend/training/train_lora.py` natively fine-tunes DistilBERT using PEFT)
6. **RAG**: ✅ IMPLEMENTED (`backend/rag/pipeline.py` handles chunking, embedding, indexing, retrieval, and generation)
7. **FAISS retrieval**: ✅ IMPLEMENTED (`backend/rag/vector_store.py` builds the L2 index and handles top-K nearest-neighbor queries)
8. **LLM integration**: ✅ IMPLEMENTED (`backend/rag/generator.py` securely bridges the retrieved context into a local `flan-t5-small` instance via Hugging Face)
9. **Firebase database**: ✅ IMPLEMENTED (`backend/firebase_config.py` interfaces with Firestore and Storage)
10. **FastAPI APIs**: ✅ IMPLEMENTED (`backend/main.py` provides the `/api/chat/message` orchestration layer)
11. **Frontend integration**: ✅ IMPLEMENTED (`client/src/components/Chatbot.tsx` interfaces with the backend and gracefully parses/routes intent JSON)
12. **Tests**: ✅ IMPLEMENTED (`backend/test_main.py` tests APIs; `backend/nlp/evaluate.py` & `evaluate_lora.py` provide model evaluation coverage)

---

## Recommended Resume Technology Stack

Based strictly on verified, working code within this repository, here is the most accurate technology stack to list on a resume without exaggeration:

**Core Stack:** Python, TypeScript, React, FastAPI
**Cloud & Databases:** Firebase (Auth, Storage), Firestore, FAISS
**AI & Machine Learning:** PyTorch, Hugging Face Transformers, PEFT (LoRA), Scikit-Learn, Pandas, NumPy
**Architectural Concepts:** Retrieval-Augmented Generation (RAG), Fine-Tuning, Natural Language Processing (NER, Intent Classification), RESTful API Design

**Do NOT list:** OpenRouter, GPT-4o, or Git/GitHub (until version control is initialized).
