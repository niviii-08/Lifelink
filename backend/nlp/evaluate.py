import pandas as pd
from sklearn.metrics import accuracy_score, precision_recall_fscore_support, confusion_matrix
import os
from .pipeline import get_nlp_pipeline

def evaluate_intents(data_path: str):
    if not os.path.exists(data_path):
        print(f"Data file {data_path} not found.")
        return
        
    df = pd.read_csv(data_path)
    pipeline = get_nlp_pipeline()
    
    y_true = df['intent'].tolist()
    y_pred = []
    
    print(f"Evaluating on {len(df)} samples from {os.path.basename(data_path)}...")
    for text in df['text']:
        result = pipeline.process(text)
        y_pred.append(result['intent'])
        
    acc = accuracy_score(y_true, y_pred)
    precision, recall, f1, _ = precision_recall_fscore_support(y_true, y_pred, average='weighted', zero_division=0)
    cm = confusion_matrix(y_true, y_pred)
    
    print("-" * 30)
    print(f"Results for {os.path.basename(data_path)}:")
    print(f"Accuracy:  {acc:.4f}")
    print(f"Precision: {precision:.4f}")
    print(f"Recall:    {recall:.4f}")
    print(f"F1 Score:  {f1:.4f}")
    print("Confusion Matrix:")
    print(cm)
    print("-" * 30)

if __name__ == "__main__":
    synthetic_path = os.path.join(os.path.dirname(__file__), "../data/intents/synthetic_data.csv")
    external_path = os.path.join(os.path.dirname(__file__), "../data/intents/external_data.csv")
    
    evaluate_intents(synthetic_path)
    evaluate_intents(external_path)
