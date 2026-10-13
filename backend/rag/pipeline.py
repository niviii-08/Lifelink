import os
from .embeddings import Embedder
from .vector_store import VectorStore
from .generator import AnswerGenerator

class RAGPipeline:
    def __init__(self, index_dir):
        self.embedder = Embedder()
        self.vector_store = VectorStore()
        self.generator = AnswerGenerator()
        self.index_dir = index_dir
        
        # Load the index if it exists
        success = self.vector_store.load(self.index_dir)
        if not success:
            print("Warning: FAISS index not found. RAG will not return results.")
            
    def query(self, question: str, top_k=3):
        # 1. Embed the question
        query_embedding = self.embedder.encode(question)
        
        # 2. Retrieve chunks
        results = self.vector_store.search(query_embedding, k=top_k)
        
        # 3. Format context
        contexts = []
        retrieved_chunks = []
        metadata = []
        scores = []
        
        for res in results:
            chunk = res["chunk"]
            contexts.append(chunk["text"])
            retrieved_chunks.append(chunk["text"])
            metadata.append({"filename": chunk["filename"]})
            scores.append(res["score"])
            
        # 4. Generate answer
        answer = self.generator.generate(question, contexts)
        
        return {
            "answer": answer,
            "retrieved_chunks": retrieved_chunks,
            "document_metadata": metadata,
            "similarity_scores": scores
        }

# Singleton instance
rag_pipeline = None

def get_rag_pipeline(index_dir):
    global rag_pipeline
    if rag_pipeline is None:
        rag_pipeline = RAGPipeline(index_dir)
    return rag_pipeline
