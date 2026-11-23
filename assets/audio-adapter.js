export class BrowserAudioAdapter {
  constructor(element) {
    if (!(element instanceof HTMLAudioElement)) throw new TypeError('Нужен HTMLAudioElement.');
    this.element = element; this.currentUrl = null; this.listeners = new Map(); this.handlers = new Map();
    for (const type of ['play','pause','ended','timeupdate','loadedmetadata','durationchange','error','waiting','canplay']) {
      const handler = event => this.listeners.get(type)?.forEach(callback => callback(event));
      this.handlers.set(type, handler); element.addEventListener(type, handler);
    }
  }
  on(type, callback) {
    if (!this.listeners.has(type)) this.listeners.set(type, new Set());
    this.listeners.get(type).add(callback);
    return () => this.listeners.get(type)?.delete(callback);
  }
  async play(track) {
    if (!track?.file && !track?.url) throw new Error('У композиции нет доступного аудиофайла.');
    this.element.pause();
    this.element.removeAttribute('src');
    this.element.load();
    this.revokeObjectUrl();
    const source = track.file instanceof Blob ? URL.createObjectURL(track.file) : track.url;
    this.currentUrl = track.file instanceof Blob ? source : null;
    this.element.src = source;
    this.element.load();
    await this.element.play();
  }
  async resume() { await this.element.play(); }
  pause() { this.element.pause(); }
  stop() { this.element.pause(); this.element.removeAttribute('src'); this.element.load(); this.revokeObjectUrl(); }
  seek(seconds) {
    if (!Number.isFinite(seconds) || !Number.isFinite(this.element.duration)) return;
    this.element.currentTime = Math.max(0, Math.min(seconds, this.element.duration || 0));
  }
  setVolume(value) { this.element.volume = Math.max(0, Math.min(1, Number(value) || 0)); }
  setRepeat(enabled) { this.element.loop = Boolean(enabled); }
  getStatus() { return { playing: !this.element.paused && !this.element.ended, position: this.element.currentTime || 0, duration: Number.isFinite(this.element.duration) ? this.element.duration : 0 }; }
  revokeObjectUrl() { if (this.currentUrl) URL.revokeObjectURL(this.currentUrl); this.currentUrl = null; }
  destroy() { this.pause(); this.element.removeAttribute('src'); this.element.load(); this.revokeObjectUrl(); for (const [type,handler] of this.handlers) this.element.removeEventListener(type,handler); this.handlers.clear(); this.listeners.clear(); }
}

// The desktop adapter is intentionally separate: it uses Rust commands and never
// replaces the existing Rodio worker with a browser-side audio pipeline.
export class DesktopAudioAdapter {
  constructor(invoke) {
    if (typeof invoke !== 'function') throw new TypeError('Tauri invoke недоступен.');
    this.invoke = invoke;
  }
  play(track) { if (!track?.nativePath) throw new Error('У композиции нет нативного пути QWEMU.'); return this.invoke('audio_play', { path: track.nativePath }); }
  pause() { return this.invoke('audio_pause'); }
  resume() { return this.invoke('audio_resume'); }
  stop() { return this.invoke('audio_stop'); }
  seek(seconds) { return this.invoke('audio_seek', { seconds: Number(seconds) }); }
  setVolume(value) { return this.invoke('audio_set_volume', { value: Number(value) }); }
  setEqualizer(enabled, bands) { return this.invoke('audio_set_eq', { enabled: Boolean(enabled), bands }); }
  getStatus() { return this.invoke('audio_status'); }
}

export function createAudioAdapter(element) {
  const core = globalThis.__TAURI__?.core;
  const invoke = typeof core?.invoke === 'function' ? core.invoke.bind(core) : null;
  return invoke ? new DesktopAudioAdapter(invoke) : new BrowserAudioAdapter(element);
}
