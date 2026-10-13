import faiss
import numpy as np
import pickle
import os

class VectorStore:
    def __init__(self, dimension=384, index_path="faiss_index.bin", chunks_path="chunks.pkl"):
        self.dimension = dimension
        self.index_path = index_path
        self.chunks_path = chunks_path
        self.index = faiss.IndexFlatL2(self.dimension)
        self.chunks = []
        
    def add_embeddings(self, embeddings, chunks):
        """Adds embeddings and corresponding chunk metadata to the store."""
        if len(embeddings) == 0:
            return
            
        faiss.normalize_L2(embeddings)
        self.index.add(embeddings)
        self.chunks.extend(chunks)
        
    def search(self, query_embedding, k=3):
        """Searches the index for the top k most similar chunks."""
        if self.index.ntotal == 0:
            return []
            
        query_embedding = np.array([query_embedding])
        faiss.normalize_L2(query_embedding)
        
        distances, indices = self.index.search(query_embedding, k)
        
        results = []
        for i, idx in enumerate(indices[0]):
            if idx != -1 and idx < len(self.chunks):
                results.append({
                    "chunk": self.chunks[idx],
                    "score": float(distances[0][i])
                })
        return results
        
    def save(self, directory):
        """Saves the index and chunks to disk."""
        if not os.path.exists(directory):
            os.makedirs(directory)
            
        faiss.write_index(self.index, os.path.join(directory, self.index_path))
        with open(os.path.join(directory, self.chunks_path), "wb") as f:
            pickle.dump(self.chunks, f)
            
    def load(self, directory):
        """Loads the index and chunks from disk."""
        idx_file = os.path.join(directory, self.index_path)
        chk_file = os.path.join(directory, self.chunks_path)
        
        if os.path.exists(idx_file) and os.path.exists(chk_file):
            self.index = faiss.read_index(idx_file)
            with open(chk_file, "rb") as f:
                self.chunks = pickle.load(f)
            return True
        return False
