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
