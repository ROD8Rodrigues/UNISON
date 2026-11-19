'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unisonOverlay', {
  onState: (callback) => {
    const listener = (_event, state) => {
      if (callback) callback(state);
    };
    ipcRenderer.on('overlay:state', listener);
    return () => ipcRenderer.removeListener('overlay:state', listener);
  },
  onInteractive: (callback) => {
    const listener = (_event, interactive) => {
      if (callback) callback(Boolean(interactive));
    };
    ipcRenderer.on('overlay:interactive', listener);
    return () => ipcRenderer.removeListener('overlay:interactive', listener);
  },
  setInteractive: (interactive) => {
    ipcRenderer.send('voice:interactive', Boolean(interactive));
  },
  command: (action) => {
    ipcRenderer.send('voice:overlay-command', { action });
  },
});
