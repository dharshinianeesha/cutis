# Training the skin model

The live app works without this (rule-based scan). Training adds a model that predicts skin type from the photo.

## What data you need
Face images in folders by label (`data/train/Oily`, `data/train/Dry`, ...). Candidate sources (check each licence and consent terms before use):
- Google **SCIN** and **Fitzpatrick17k**: skin images with Fitzpatrick / Monk skin-tone labels (useful for a tone model).
- Kaggle datasets of **oily / dry / normal** face skin photos (useful for a skin-type model).

No public dataset pairs photos with clinical hydration or sebum readings, so hydration and oil are NOT learned here. The model predicts labels only.

## Train
```bash
pip install -r requirements.txt
python train.py --data data --out model_out --epochs 8
```
Reports validation (and test, if a `test/` folder exists) accuracy and a confusion matrix in `model_out/metrics.json`. Use those real numbers in your report.

## Use it in the website
```bash
tensorflowjs_converter --input_format=keras model_out/model.keras ../frontend/public/model
cp model_out/labels.json ../frontend/public/model/labels.json
```
Redeploy the frontend. If `model/model.json` exists, the app loads it automatically and shows "Trained model: <type> (xx% confidence)" next to the rule-based result.

`python train.py --data <synthetic folder> --smoke --size 96` runs a tiny-CNN check of the pipeline in seconds.
