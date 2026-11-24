// bin/_capture-init.js — loaded into the capture helper's own browser before the studio's code (#228).
// A capture opens the studio in a browser with no history, so the questions the studio asks a person once
// (the sync consent sheet) would be asked again and would cover the very window the capture is of.
// Nothing here answers a question: the studio only holds it back while this window is a capture.
window.__MAUDE_CAPTURE__ = true;
