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

