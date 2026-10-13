import pytest
from nlp.pipeline import get_nlp_pipeline
from nlp.normalization import normalize_blood_group, normalize_quantity

def test_normalization():
    assert normalize_blood_group("o positive") == "O+"
    assert normalize_blood_group("AB-") == "AB-"
    assert normalize_blood_group("O POS") == "O+"
    
    assert normalize_quantity("two") == 2
    assert normalize_quantity("5") == 5
    assert normalize_quantity("ten units") == 10

def test_pipeline_integration():
    pipeline = get_nlp_pipeline()
    text = "I urgently need 2 units of O positive blood at a hospital in Coimbatore."
    
    result = pipeline.process(text)
    
    assert "intent" in result
    # It should identify it as an emergency request
    assert result["intent"] in ["emergency_request", "blood_search"]
    
    if "blood_group" in result:
        assert result["blood_group"] == "O+"
    
    if "quantity" in result:
        assert result["quantity"] == 2
