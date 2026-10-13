import re
from transformers import pipeline

class NamedEntityExtractor:
    def __init__(self):
        # Standard NER for Location and Organization (Hospital)
        self.ner_pipeline = pipeline("ner", model="dslim/bert-base-NER", aggregation_strategy="simple")
        
    def extract(self, text: str) -> dict:
        entities = {
            "blood_group": None,
            "quantity": None,
            "hospital": None,
            "location": None
        }
        
        # 1. Regex for Blood Group
        bg_match = re.search(r'(?i)\b(A|B|AB|O)[\s\-]*(positive|negative|pos|neg|\+|\-)\b', text)
        if bg_match:
            entities["blood_group"] = bg_match.group(0)
            
        # 2. Regex for Quantity
        qty_match = re.search(r'(?i)\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(units?|bags?|packs?)\b', text)
        if qty_match:
            entities["quantity"] = qty_match.group(1)
            
        # 3. Transformer NER for Locations and Organizations
        ner_results = self.ner_pipeline(text)
        
        hospitals = []
        locations = []
        
        for ent in ner_results:
            if ent["entity_group"] == "ORG" and "hospital" in text.lower():
                hospitals.append(ent["word"])
            elif ent["entity_group"] == "LOC":
                locations.append(ent["word"])
                
        if hospitals:
            entities["hospital"] = " ".join(hospitals)
        if locations:
            entities["location"] = " ".join(locations)
            
        return entities
