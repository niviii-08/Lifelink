import re

def normalize_blood_group(bg_text: str) -> str:
    """Normalize blood group strings to standard format (e.g. 'O+', 'AB-')."""
    if not bg_text:
        return ""
    
    text = bg_text.lower().replace(" ", "")
    
    # Map common textual representations
    mapping = {
        "opositive": "O+", "opos": "O+", "o+": "O+",
        "onegative": "O-", "oneg": "O-", "o-": "O-",
        "apositive": "A+", "apos": "A+", "a+": "A+",
        "anegative": "A-", "aneg": "A-", "a-": "A-",
        "bpositive": "B+", "bpos": "B+", "b+": "B+",
        "bnegative": "B-", "bneg": "B-", "b-": "B-",
        "abpositive": "AB+", "abpos": "AB+", "ab+": "AB+",
        "abnegative": "AB-", "abneg": "AB-", "ab-": "AB-"
    }
    
    # Sort keys by length descending so 'ab-' is checked before 'b-'
    for key in sorted(mapping.keys(), key=len, reverse=True):
        if key in text:
            return mapping[key]
    
    # Simple regex fallback
    match = re.search(r'(a|b|ab|o)[ \-]*(pos|neg|\+|\-)', text)
    if match:
        group = match.group(1).upper()
        sign_str = match.group(2)
        sign = "+" if "pos" in sign_str or "+" in sign_str else "-"
        return f"{group}{sign}"
        
    return bg_text

def normalize_quantity(qty_text: str) -> int:
    """Normalize quantity string to an integer."""
    if not qty_text:
        return 1
    
    # Word to number mapping
    words = {
        "one": 1, "a": 1, "two": 2, "three": 3, "four": 4, 
        "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10
    }
    
    text = qty_text.lower()
    
    # Look for digits
    match = re.search(r'\d+', text)
    if match:
        return int(match.group(0))
        
    # Look for words
    for word, num in words.items():
        if word in text:
            return num
            
    return 1
