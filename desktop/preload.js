'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unisonDesktop', {
  isDesktop: true,
  platform: process.platform,
  updateVoiceOverlay: (state) => {
    ipcRenderer.send('voice:update', state);
  },
  setVoiceOverlayInteractive: (interactive) => {
    ipcRenderer.send('voice:interactive', Boolean(interactive));
  },
  onVoiceOverlayCommand: (callback) => {
    const listener = (_event, command) => {
      if (callback) callback(command);
    };
    ipcRenderer.on('voice:command', listener);
    return () => ipcRenderer.removeListener('voice:command', listener);
  },
});
