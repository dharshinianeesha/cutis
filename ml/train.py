"""Train a skin classifier (skin type or skin tone) with MobileNetV2 transfer learning,
then export it for the Cutis browser app (TensorFlow.js).

Expected data layout (one folder per class):
    data/
      train/Oily/*.jpg  train/Dry/*.jpg  train/Normal/*.jpg ...
      val/Oily/*.jpg    val/Dry/*.jpg    ...      (optional; if missing, 20% of train is held out)
      test/...                                      (optional; reported at the end if present)

Usage:
    python train.py --data data --out model_out --epochs 8
    python train.py --data data --out model_out --smoke --epochs 8 --size 96   # quick pipeline check with a tiny CNN

Outputs in --out: model.keras, labels.json, metrics.json (accuracy + confusion matrix).
Then convert for the browser (copy the result into frontend/public/model/):
    tensorflowjs_converter --input_format=keras model_out/model.keras frontend_model/
    cp model_out/labels.json frontend_model/labels.json
"""
import argparse, json, os, pathlib
import numpy as np
import tensorflow as tf
from tensorflow.keras import layers

ap = argparse.ArgumentParser()
ap.add_argument('--data', required=True)
ap.add_argument('--out', default='model_out')
ap.add_argument('--epochs', type=int, default=8)
ap.add_argument('--finetune-epochs', type=int, default=4)
ap.add_argument('--batch', type=int, default=32)
ap.add_argument('--size', type=int, default=224)
ap.add_argument('--no-pretrained', action='store_true', help='random init (offline smoke tests only)')
ap.add_argument('--smoke', action='store_true')
a = ap.parse_args()
tf.keras.utils.set_random_seed(42)
data = pathlib.Path(a.data); out = pathlib.Path(a.out); out.mkdir(parents=True, exist_ok=True)
img = (a.size, a.size)

def load(split, **kw):
    return tf.keras.utils.image_dataset_from_directory(data / split, image_size=img, batch_size=a.batch, label_mode='int', **kw)

if (data / 'val').exists():
    train_ds = load('train', shuffle=True, seed=42); val_ds = load('val', shuffle=False)
else:
    train_ds = load('train', validation_split=0.2, subset='training', seed=42)
    val_ds = load('train', validation_split=0.2, subset='validation', seed=42)
labels = train_ds.class_names; n = len(labels)
print('classes:', labels)
counts = np.zeros(n)
for _, y in train_ds.unbatch(): counts[int(y)] += 1
class_weight = {i: float(counts.sum() / (n * max(c, 1))) for i, c in enumerate(counts)}  # handle class imbalance
print('train images per class:', dict(zip(labels, counts.astype(int).tolist())))

augment = tf.keras.Sequential([layers.RandomFlip('horizontal'), layers.RandomRotation(0.05), layers.RandomZoom(0.1),
                               layers.RandomBrightness(0.2), layers.RandomContrast(0.2)])
if a.smoke:   # tiny CNN so the whole pipeline can be exercised in seconds on synthetic data
    base = tf.keras.Sequential([layers.Conv2D(16, 3, activation='relu'), layers.MaxPooling2D(), layers.Conv2D(32, 3, activation='relu')])
else:
    base = tf.keras.applications.MobileNetV2(input_shape=img + (3,), include_top=False, weights=None if a.no_pretrained else 'imagenet')
    base.trainable = a.no_pretrained   # a pretrained backbone starts frozen; a random-init one must be trained
inp = layers.Input(shape=img + (3,))
x = augment(inp)
x = layers.Rescaling(1 / 127.5, offset=-1)(x)   # preprocessing lives inside the model, so the browser passes raw 0-255 pixels
x = base(x, training=False)
x = layers.GlobalAveragePooling2D()(x); x = layers.Dropout(0.3)(x)
model = tf.keras.Model(inp, layers.Dense(n, activation='softmax')(x))
cb = [tf.keras.callbacks.EarlyStopping(patience=3, restore_best_weights=True, monitor='val_accuracy')]
model.compile(optimizer=tf.keras.optimizers.Adam(1e-3), loss='sparse_categorical_crossentropy', metrics=['accuracy'])
model.fit(train_ds, validation_data=val_ds, epochs=a.epochs, class_weight=class_weight, callbacks=cb, verbose=2)
if not a.smoke and not a.no_pretrained and a.finetune_epochs > 0:
    base.trainable = True
    for l in base.layers[:-30]: l.trainable = False      # fine-tune only the top of the backbone
    model.compile(optimizer=tf.keras.optimizers.Adam(1e-5), loss='sparse_categorical_crossentropy', metrics=['accuracy'])
    model.fit(train_ds, validation_data=val_ds, epochs=a.finetune_epochs, class_weight=class_weight, callbacks=cb, verbose=2)

def evaluate(ds):
    y_true = np.concatenate([y.numpy() for _, y in ds]); y_pred = np.argmax(model.predict(ds, verbose=0), axis=1)
    cm = tf.math.confusion_matrix(y_true, y_pred, num_classes=n).numpy()
    return {'accuracy': float((y_true == y_pred).mean()), 'confusion_matrix': cm.tolist(), 'samples': int(len(y_true))}
metrics = {'labels': labels, 'validation': evaluate(val_ds)}
if (data / 'test').exists(): metrics['test'] = evaluate(load('test', shuffle=False))
(out / 'labels.json').write_text(json.dumps(labels)); (out / 'metrics.json').write_text(json.dumps(metrics, indent=2))
model.save(out / 'model.keras')
print(json.dumps({k: (v['accuracy'] if isinstance(v, dict) else v) for k, v in metrics.items()}, indent=2))
print('Saved to', out)
