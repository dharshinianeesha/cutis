// Real pixel-based heuristic — NOT a clinical or dermatologist-trained model.
// It samples the center of the captured frame (roughly where a face sits
// behind the oval guide) and derives three numbers from actual pixel values:
//  - redness:    how much the red channel dominates green/blue, averaged
//  - oil/shine:  the fraction of sampled pixels that are near-overexposed
//                (specular highlights read as shine on skin)
//  - hydration:  NOT directly measurable from a photo. This is a weak proxy
//                combining overall brightness evenness (less harsh local
//                contrast) with the inverse of the shine reading. Flagged
//                to the user in the UI as an estimate, not a measurement.
function analyzeSkinFromImageData(imageData){
  const { data, width, height } = imageData;
  const cx0 = Math.floor(width * 0.3), cx1 = Math.floor(width * 0.7);
  const cy0 = Math.floor(height * 0.2), cy1 = Math.floor(height * 0.75);
  let rSum=0, gSum=0, bSum=0, n=0;
  let brightSum=0, brightSumSq=0;
  let highlightPixels=0;
  for(let y=cy0; y<cy1; y+=2){
    for(let x=cx0; x<cx1; x+=2){
      const i = (y*width + x) * 4;
      const r=data[i], g=data[i+1], b=data[i+2];
      rSum+=r; gSum+=g; bSum+=b;
      const brightness = (r+g+b)/3;
      brightSum += brightness;
      brightSumSq += brightness*brightness;
      if(brightness > 225) highlightPixels++;
      n++;
    }
  }
  if(n===0) return null;
  const rAvg=rSum/n, gAvg=gSum/n, bAvg=bSum/n;
  const brightAvg = brightSum/n;
  const variance = Math.max(0, brightSumSq/n - brightAvg*brightAvg);
  const stdDev = Math.sqrt(variance);

  const lab = rgbToLab(rAvg, gAvg, bAvg);
  // Redness uses CIE a* (green-red axis), which is how colourimetric skin studies track erythema.
  // Typical facial a* is about 10-24, so 10 maps to 0 and 24 maps to 100.
  const redness = Math.round(Math.max(0, Math.min(100, (lab.a - 10) / 14 * 100)));

  const shineFraction = highlightPixels / n;
  const oil = Math.round(Math.max(0, Math.min(100, shineFraction * 300 + (brightAvg/255)*20)));

  // Lower local-contrast + not-too-shiny reads as "smoother/more hydrated-looking".
  const smoothness = Math.max(0, 100 - stdDev * 1.8);
  const hydration = Math.round(Math.max(0, Math.min(100, smoothness * 0.6 + (100-oil) * 0.25 + (brightAvg/255)*100*0.15)));

  const ita = Math.abs(lab.b) < 0.01 ? (lab.L > 50 ? 90 : -90) : Math.atan((lab.L - 50) / lab.b) * 180 / Math.PI;
  return { hydration, oil, redness, ita: Math.round(ita * 10) / 10 };
}
// sRGB -> CIE L*a*b* (D65). Used for the Individual Typology Angle skin-tone estimate.
function rgbToLab(r, g, b){
  const lin = v => { v/=255; return v<=0.04045 ? v/12.92 : Math.pow((v+0.055)/1.055, 2.4); };
  const R=lin(r), G=lin(g), B=lin(b);
  let X=(R*0.4124+G*0.3576+B*0.1805)/0.95047, Y=(R*0.2126+G*0.7152+B*0.0722), Z=(R*0.0193+G*0.1192+B*0.9505)/1.08883;
  const f = t => t>0.008856 ? Math.cbrt(t) : 7.787*t+16/116;
  return { L: 116*f(Y)-16, a: 500*(f(X)-f(Y)), b: 200*(f(Y)-f(Z)) };
}
let faceDetectorPromise = null;
let tensorflowPromise = null;
function loadScript(src, errorMessage = 'The analysis model could not load. Check your connection and retry.') {
  return new Promise((resolve, reject) => {
    const sc = document.createElement('script'); sc.src = src;
    sc.onload = resolve; sc.onerror = () => { sc.remove(); reject(new Error(errorMessage)); };
    document.head.appendChild(sc);
  });
}
function ensureTensorflow() {
  if (!tensorflowPromise) tensorflowPromise = loadScript('https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js').then(() => tf.ready()).catch(e => { tensorflowPromise = null; throw e; });
  return tensorflowPromise;
}
function loadFaceDetector() {
  if (!faceDetectorPromise) faceDetectorPromise = (async () => {
    await ensureTensorflow();
    if (!window.FaceDetection) await loadScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_detection@0.4.1646425229/face_detection.js');
    if (!window.faceDetection) await loadScript('https://cdn.jsdelivr.net/npm/@tensorflow-models/face-detection@1.0.3/dist/face-detection.min.js');
    return faceDetection.createDetector(faceDetection.SupportedModels.MediaPipeFaceDetector, {runtime: 'tfjs', modelType: 'short', maxFaces: 2});
  })().catch(e => { faceDetectorPromise = null; throw e; });
  return faceDetectorPromise;
}
let skinModel = null, skinLabels = null;
let skinModelPromise;
function loadSkinModel(){
  if (!skinModelPromise) skinModelPromise = (async () => {
    try {
      const head = await fetch('model/model.json', { method:'HEAD' });
      if (!head.ok || !head.headers.get('content-type')?.includes('application/json')) return;
      skinLabels = await (await fetch('model/labels.json')).json();
      await ensureTensorflow();
      skinModel = await tf.loadLayersModel('model/model.json');
    } catch (error) {
      skinModelPromise = undefined;
    }
  })();
  return skinModelPromise;
}

function estimateSkinType({ hydration, oil, redness }, faceCanvas) {
  let detected;
  if(oil >= 55 && hydration >= 50) detected = 'Oily';
  else if(oil < 30 && hydration < 50) detected = 'Dry';
  else if(oil >= 40 && hydration < 55) detected = 'Combination';
  else if(redness >= 55) detected = 'Sensitive';
  else detected = 'Normal';
  if (!skinModel) return detected;
  try {
    const shape = skinModel.inputs[0].shape;
    const scores = tf.tidy(() => {
      const input = tf.browser.fromPixels(faceCanvas).resizeBilinear([shape[1] || 224, shape[2] || 224]).expandDims(0).toFloat();
      return skinModel.predict(input).dataSync();
    });
    const best = scores.indexOf(Math.max(...scores));
    const label = skinLabels[best];
    if (scores[best] >= 0.5 && ['Normal', 'Dry', 'Oily', 'Combination', 'Sensitive'].includes(label)) return label;
  } catch (error) {
    // Keep the image estimate if an optional custom model cannot run.
  }
  return detected;
}
