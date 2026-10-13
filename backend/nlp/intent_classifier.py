import os
import torch
from transformers import pipeline, AutoTokenizer, AutoModelForSequenceClassification
from peft import PeftModel

class IntentClassifier:
    def __init__(self):
        self.lora_path = os.path.join(os.path.dirname(__file__), "../models/lora_intent")
        self.labels = ["emergency_request", "blood_search", "camp_info", "eligibility_question", "general"]
        
        if os.path.exists(self.lora_path):
            print("Loading LoRA Fine-Tuned Intent Classifier...")
            base_model_name = "distilbert-base-uncased"
            self.tokenizer = AutoTokenizer.from_pretrained(self.lora_path)
            
            # Load base model with correct num labels
            base_model = AutoModelForSequenceClassification.from_pretrained(
                base_model_name, 
                num_labels=5,
                id2label={i: l for i, l in enumerate(self.labels)},
                label2id={l: i for i, l in enumerate(self.labels)}
            )
            # Apply LoRA adapter
            self.model = PeftModel.from_pretrained(base_model, self.lora_path)
            self.model.eval()
            self.use_lora = True
        else:
            print("LoRA model not found. Falling back to zero-shot MNLI.")
            self.classifier = pipeline(
                "zero-shot-classification", 
                model="typeform/distilbert-base-uncased-mnli"
            )
            self.label_mapping = {
                "emergency request": "emergency_request",
                "searching for blood": "blood_search",
                "blood donation camp": "camp_info",
                "eligibility to donate": "eligibility_question",
                "general inquiry": "general"
            }
            self.candidate_labels = list(self.label_mapping.keys())
            self.use_lora = False
        
    def predict(self, text: str) -> dict:
        if not text.strip():
            return {"intent": "general", "confidence": 1.0}
            
        if self.use_lora:
            inputs = self.tokenizer(text, return_tensors="pt", truncation=True, padding=True, max_length=64)
            with torch.no_grad():
                outputs = self.model(**inputs)
                probs = torch.nn.functional.softmax(outputs.logits, dim=-1)
                conf, pred_id = torch.max(probs, dim=-1)
                
            return {
                "intent": self.labels[pred_id.item()],
                "confidence": conf.item()
            }
        else:
            result = self.classifier(text, self.candidate_labels)
            best_natural_label = result["labels"][0]
            confidence = result["scores"][0]
            
            return {
                "intent": self.label_mapping[best_natural_label],
                "confidence": confidence
            }
