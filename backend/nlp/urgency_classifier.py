from transformers import pipeline

class UrgencyClassifier:
    def __init__(self):
        # We can reuse the same model to save memory, or let transformers pipeline manage it
        self.classifier = pipeline(
            "zero-shot-classification", 
            model="typeform/distilbert-base-uncased-mnli"
        )
        self.candidate_labels = ["Critical", "Urgent", "Normal"]
        
    def predict(self, text: str) -> str:
        if not text.strip():
            return "Normal"
            
        result = self.classifier(text, self.candidate_labels)
        return result["labels"][0]
