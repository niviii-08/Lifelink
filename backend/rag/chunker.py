def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50):
    """Splits text into overlapping chunks."""
    words = text.split()
    chunks = []
    
    if len(words) <= chunk_size:
        return [text]
        
    i = 0
    while i < len(words):
        chunk = " ".join(words[i:i + chunk_size])
        chunks.append(chunk)
        i += chunk_size - overlap
        
    return chunks

def chunk_documents(documents, chunk_size: int = 200, overlap: int = 40):
    all_chunks = []
    for doc in documents:
        text_chunks = chunk_text(doc['content'], chunk_size, overlap)
        for i, text in enumerate(text_chunks):
            all_chunks.append({
                "doc_id": doc['id'],
                "filename": doc['filename'],
                "chunk_index": i,
                "text": text
            })
    return all_chunks
