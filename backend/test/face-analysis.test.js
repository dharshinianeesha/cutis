const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const app = fs.readFileSync(require('node:path').join(__dirname, '../../frontend/public/app.js'), 'utf8');
const source = app.slice(app.indexOf('async function captureFace()'), app.indexOf('async function saveScan('));
async function capture(faces) {
  const state = { analyzed: false, stopped: false, messages: [] };
  const context = { drawImage() {}, getImageData: (x,y,width,height) => ({width,height}) };
  const sandbox = {
    document: { createElement: () => ({ getContext: () => context }) },
    element: id => id === 'cam-video' ? {videoWidth:640,videoHeight:480} : {},
    camStream: {},
    capturing: false,
    stopCamera() { state.stopped = true; },
    loadFaceDetector: async () => ({estimateFaces: async () => faces}),
    analyzeSkinFromImageData: data => { state.analyzed = data; return { hydration:64, oil:27, redness:18 }; },
    estimateSkinType: () => 'Dry',
    saveScan: reading => { state.saved = reading; },
    showStatus: (id, text, isError) => { if (isError) state.messages.push(text); }
  };
  vm.createContext(sandbox);vm.runInContext(source,sandbox);await sandbox.captureFace();return state;
}
test('face analysis rejects empty frames, multiple faces and distant faces without saving', async () => {
  for (const faces of [[], [{},{}], [{box:{xMin:10,yMin:10,width:20,height:20}}]]) {
    const result=await capture(faces);assert.equal(result.analyzed,false);assert.equal(result.stopped,false);assert.equal(result.messages.length,1);
  }
});
test('face analysis crops a detected face before computing readings', async () => {
  const result=await capture([{box:{xMin:20,yMin:20,width:100,height:100}}]);
  assert.equal(result.analyzed.width,70);assert.equal(result.analyzed.height,65);assert.equal(result.stopped,true);assert.equal(result.messages.length,0);
  assert.equal(result.saved.detectedSkinType, 'Dry');
});
