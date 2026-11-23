const PREFIX = 'qwemu.web.v1.';
export class StorageAdapter {
  read(key, fallback) {
    try {
      const raw = globalThis.localStorage?.getItem(PREFIX + key);
      if (raw === null || raw === undefined) return fallback;
      try { return JSON.parse(raw); }
      catch (error) {
        const backupKey = `${PREFIX}corrupt.${key}.${Date.now()}`;
        try { globalThis.localStorage?.setItem(backupKey, raw); } catch {}
        console.warn(`QWEMU сохранил повреждённое значение ${key} в ${backupKey}.`, error);
        return fallback;
      }
    } catch (error) {
      console.warn(`QWEMU local preference "${key}" could not be read:`, error);
      return fallback;
    }
  }
  write(key, value) {
    try {
      if (!globalThis.localStorage) throw new Error('Локальное хранилище браузера недоступно.');
      globalThis.localStorage.setItem(PREFIX + key, JSON.stringify(value));
      return true;
    } catch (error) {
      throw new Error(`Не удалось сохранить настройки браузера: ${error?.message || error}`);
    }
  }
  remove(key) {
    try { globalThis.localStorage?.removeItem(PREFIX + key); }
    catch (error) { throw new Error(`Не удалось удалить локальные настройки: ${error?.message || error}`); }
  }
}
