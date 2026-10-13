import os
import torch
import pandas as pd
from transformers import AutoTokenizer, AutoModelForSequenceClassification
from peft import PeftModel
from sklearn.metrics import accuracy_score, precision_recall_fscore_support

def evaluate_model(model, tokenizer, dataset, device="cpu"):
    model.to(device)
    model.eval()
    
    y_true = []
    y_pred = []
    
    labels_map = {"emergency_request": 0, "blood_search": 1, "camp_info": 2, "eligibility_question": 3, "general": 4}
    
    for _, row in dataset.iterrows():
        text = row["text"]
        true_intent = row["intent"]
        
        inputs = tokenizer(text, return_tensors="pt", truncation=True, padding=True, max_length=64).to(device)
        with torch.no_grad():
            outputs = model(**inputs)
            pred_id = outputs.logits.argmax(dim=-1).item()
            
        y_true.append(labels_map[true_intent])
        y_pred.append(pred_id)
        
    acc = accuracy_score(y_true, y_pred)
    precision, recall, f1, _ = precision_recall_fscore_support(y_true, y_pred, average='weighted', zero_division=0)
    
    return acc, precision, recall, f1

def main():
    base_model_name = "distilbert-base-uncased"
    lora_model_path = os.path.join(os.path.dirname(__file__), "../models/lora_intent")
    val_file = os.path.join(os.path.dirname(__file__), "../data/intent_val.csv")
    
    dataset = pd.read_csv(val_file)
    
    print("Loading Base Model...")
    tokenizer = AutoTokenizer.from_pretrained(base_model_name)
    base_model = AutoModelForSequenceClassification.from_pretrained(base_model_name, num_labels=5)
    
    print("Evaluating Base Model...")
    b_acc, b_prec, b_rec, b_f1 = evaluate_model(base_model, tokenizer, dataset)
    
    print("\nLoading LoRA Fine-Tuned Model...")
    lora_model = PeftModel.from_pretrained(base_model, lora_model_path)
    
    print("Evaluating LoRA Model...")
    l_acc, l_prec, l_rec, l_f1 = evaluate_model(lora_model, tokenizer, dataset)
    
    print("\n" + "="*40)
    print("COMPARISON REPORT")
    print("="*40)
    print(f"{'Metric':<15} | {'Base Model':<15} | {'LoRA Model':<15}")
    print("-" * 45)
    print(f"{'Accuracy':<15} | {b_acc:<15.4f} | {l_acc:<15.4f}")
    print(f"{'Precision':<15} | {b_prec:<15.4f} | {l_prec:<15.4f}")
    print(f"{'Recall':<15} | {b_rec:<15.4f} | {l_rec:<15.4f}")
    print(f"{'F1 Score':<15} | {b_f1:<15.4f} | {l_f1:<15.4f}")
    print("="*40)

if __name__ == "__main__":
    main()
