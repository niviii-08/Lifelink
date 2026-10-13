# Model Card: LifeLink Intent Classifier (LoRA)

## Model Details
* **Base Architecture**: `distilbert-base-uncased`
* **Fine-Tuning Method**: PEFT (Parameter-Efficient Fine-Tuning) using LoRA (Low-Rank Adaptation)
* **Task**: Sequence Classification (5-class intent detection)
* **Frameworks**: PyTorch, Hugging Face Transformers, PEFT

## Intended Use
This model classifies incoming natural language requests into one of five intents:
1. `emergency_request`: Urgent requests for blood.
2. `blood_search`: General non-urgent searches for blood donors.
3. `camp_info`: Inquiries about blood donation camps.
4. `eligibility_question`: Questions regarding donor eligibility (e.g., tattoos, age, health conditions).
5. `general`: General greetings, acknowledgments, or unknown intents.

It is intended to be used as the first step in the LifeLink NLP Pipeline to route requests appropriately.

## Training Data
* **Source**: The model was fine-tuned on a custom synthetic dataset (`backend/data/intent_train.csv`).
* **Volume**: 40 training samples and 15 validation samples.
* **Format**: Comma-separated values (CSV) containing `text` and `intent`.

## Training Procedure
* **LoRA Parameters**:
  * Rank (`r`): 8
  * Alpha (`lora_alpha`): 16
  * Dropout (`lora_dropout`): 0.1
  * Target Modules: `q_lin` and `v_lin` (Attention modules of DistilBERT)
* **Hyperparameters**:
  * Learning Rate: `2e-4`
  * Batch Size: `8`
  * Epochs: `5`
  * Weight Decay: `0.01`
  * Max Sequence Length: `64`

## Evaluation Results
The model was evaluated on the unseen validation dataset (`intent_val.csv`). 

Because we use Parameter-Efficient Fine-Tuning on an untrained classification head, the base model performs randomly, while the LoRA model adapts rapidly to the intents. (See output of `evaluation/evaluate_lora.py` for exact realtime metrics).

## Integration
The trained adapter weights are saved in `backend/models/lora_intent/`. The inference pipeline uses `PeftModel.from_pretrained` to load these weights on top of the base DistilBERT architecture efficiently, enabling fast CPU inference for the FastAPI service.
