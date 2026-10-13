from transformers import AutoTokenizer, AutoModelForSeq2SeqLM

class AnswerGenerator:
    def __init__(self, model_name="google/flan-t5-small"):
        self.tokenizer = AutoTokenizer.from_pretrained(model_name)
        self.model = AutoModelForSeq2SeqLM.from_pretrained(model_name)
        
    def generate(self, question, contexts):
        if not contexts:
            return "I don't have enough information in my knowledge base to answer that."
            
        context_text = "\n\n".join(contexts)
        
        prompt = f"""Read the following context carefully. Answer the question based ONLY on the context provided. If the context does not contain the answer, say "I don't know".

Context:
{context_text}

Question: {question}

Answer:"""
        
        inputs = self.tokenizer(prompt, return_tensors="pt", truncation=True, max_length=512)
        outputs = self.model.generate(**inputs, max_new_tokens=100, temperature=0.1, do_sample=True)
        return self.tokenizer.decode(outputs[0], skip_special_tokens=True)
