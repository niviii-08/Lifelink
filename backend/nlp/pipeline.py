from .intent_classifier import IntentClassifier
from .ner import NamedEntityExtractor
from .urgency_classifier import UrgencyClassifier
from .normalization import normalize_blood_group, normalize_quantity

class NLPPipeline:
    def __init__(self):
        # Initialize models lazily or eagerly
        self.intent_clf = IntentClassifier()
        self.ner_extractor = NamedEntityExtractor()
        self.urgency_clf = UrgencyClassifier()
        
    def process(self, text: str) -> dict:
        # 1. Intent Classification
        intent_result = self.intent_clf.predict(text)
        
        # If it's an emergency, extract more details
        entities = {}
        urgency = "Normal"
        
        if intent_result["intent"] in ["emergency_request", "blood_search"]:
            # 2. NER
            raw_entities = self.ner_extractor.extract(text)
            
            # 3. Urgency
            urgency = self.urgency_clf.predict(text)
            
            # 4. Normalization
            entities = {
                "blood_group": normalize_blood_group(raw_entities.get("blood_group", "")),
                "quantity": normalize_quantity(raw_entities.get("quantity", "")),
                "hospital": raw_entities.get("hospital"),
                "location": raw_entities.get("location")
            }
            
        return {
            "intent": intent_result["intent"],
            "confidence": intent_result["confidence"],
            "urgency": urgency,
            **entities
        }

# Singleton instance
nlp_pipeline = None

def get_nlp_pipeline():
    global nlp_pipeline
    if nlp_pipeline is None:
        nlp_pipeline = NLPPipeline()
    return nlp_pipeline
