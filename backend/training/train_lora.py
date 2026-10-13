import os
import sys
import torch
import pandas as pd
from datasets import load_dataset
from transformers import (
    AutoTokenizer,
    AutoModelForSequenceClassification,
    TrainingArguments,
    Trainer,
    DataCollatorWithPadding
)
from peft import get_peft_model, LoraConfig, TaskType
from sklearn.metrics import accuracy_score, precision_recall_fscore_support

def compute_metrics(pred):
    labels = pred.label_ids
    preds = pred.predictions.argmax(-1)
    precision, recall, f1, _ = precision_recall_fscore_support(labels, preds, average='weighted', zero_division=0)
    acc = accuracy_score(labels, preds)
    return {
        'accuracy': acc,
        'f1': f1,
        'precision': precision,
        'recall': recall
    }

def main():
    # 1. Configuration
    model_name = "distilbert-base-uncased"
    output_dir = os.path.join(os.path.dirname(__file__), "../models/lora_intent")
    train_file = os.path.join(os.path.dirname(__file__), "../data/intent_train.csv")
    val_file = os.path.join(os.path.dirname(__file__), "../data/intent_val.csv")
    
    # 2. Labels mapping
    labels = ["emergency_request", "blood_search", "camp_info", "eligibility_question", "general"]
    label2id = {label: i for i, label in enumerate(labels)}
    id2label = {i: label for i, label in enumerate(labels)}
    
    # 3. Load Datasets
    dataset = load_dataset("csv", data_files={"train": train_file, "validation": val_file})
    
    # 4. Tokenizer
    tokenizer = AutoTokenizer.from_pretrained(model_name)
    
    def tokenize_function(examples):
        tokens = tokenizer(examples["text"], padding="max_length", truncation=True, max_length=64)
        tokens["label"] = [label2id[l] for l in examples["intent"]]
        return tokens

    tokenized_datasets = dataset.map(tokenize_function, batched=True)
    
    # 5. Load Base Model
    model = AutoModelForSequenceClassification.from_pretrained(
        model_name,
        num_labels=len(labels),
        label2id=label2id,
        id2label=id2label
    )
    
    # 6. LoRA Configuration
    peft_config = LoraConfig(
        task_type=TaskType.SEQ_CLS,
        inference_mode=False,
        r=8,
        lora_alpha=16,
        lora_dropout=0.1,
        target_modules=["q_lin", "v_lin"]
    )
    
    model = get_peft_model(model, peft_config)
    model.print_trainable_parameters()
    
    # 7. Training Arguments
    training_args = TrainingArguments(
        output_dir=output_dir,
        learning_rate=2e-4,
        per_device_train_batch_size=8,
        per_device_eval_batch_size=8,
        num_train_epochs=5,
        weight_decay=0.01,
        eval_strategy="epoch",
        save_strategy="epoch",
        load_best_model_at_end=True,
        logging_steps=5,
        remove_unused_columns=True,
    )
    
    data_collator = DataCollatorWithPadding(tokenizer=tokenizer)
    
    # 8. Trainer
    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=tokenized_datasets["train"],
        eval_dataset=tokenized_datasets["validation"],
        processing_class=tokenizer,
        data_collator=data_collator,
        compute_metrics=compute_metrics,
    )
    
    # 9. Train and Save
    print("Starting LoRA Fine-Tuning...")
    trainer.train()
    
    print(f"Saving LoRA model to {output_dir}")
    model.save_pretrained(output_dir)
    tokenizer.save_pretrained(output_dir)
    
    # 10. Final Evaluation
    metrics = trainer.evaluate()
    print("Final Validation Metrics:", metrics)

if __name__ == "__main__":
    main()
