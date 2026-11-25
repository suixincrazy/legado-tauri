import { replaceText } from './replacement-engine';
self.onmessage = event => {
  try { self.postMessage({ text: replaceText(event.data.text, event.data.rule) }); }
  catch (error) { self.postMessage({ error: String(error) }); }
};
