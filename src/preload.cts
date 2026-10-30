import { contextBridge, ipcRenderer } from 'electron';

// This file is .cts on purpose: sandboxed preloads only support CommonJS,
// while the rest of the app is ESM. tsc emits it as out/main/preload.cjs.
// Keep in sync with the PetBridge interface in src/renderer/types.d.ts
// (this file compiles without the DOM lib, so it can't reference it directly).
contextBridge.exposeInMainWorld('pet', {
  onInit: (cb: (v: unknown) => void) => ipcRenderer.on('pet:init', (_e, v) => cb(v)),
  onState: (cb: (v: unknown) => void) => ipcRenderer.on('pet:state', (_e, v) => cb(v)),
  onGaze: (cb: (v: unknown) => void) => ipcRenderer.on('pet:gaze', (_e, v) => cb(v)),
  onMotion: (cb: (v: unknown) => void) => ipcRenderer.on('pet:motion', (_e, v) => cb(v)),
  hover: (over: boolean) => ipcRenderer.send('pet:hover', over),
  dragStart: () => ipcRenderer.send('pet:dragstart'),
  dragEnd: () => ipcRenderer.send('pet:dragend'),
  menu: () => ipcRenderer.send('pet:menu'),
});
