export class ApiAdapter {
  constructor(baseUrl = '', timeoutMs = 15000) {
    this.baseUrl = baseUrl;
    this.timeoutMs = Number.isFinite(timeoutMs) ? Math.max(1000, Math.min(60000, timeoutMs)) : 15000;
  }

  async request(path, options = {}) {
    const headers = new Headers(options.headers || {});
    if (options.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');

    const controller = new AbortController();
    const externalSignal = options.signal;
    const abortFromCaller = () => controller.abort(externalSignal?.reason);
    if (externalSignal?.aborted) abortFromCaller();
    else externalSignal?.addEventListener('abort', abortFromCaller, { once: true });

    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('Request timeout'));
    }, this.timeoutMs);

    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        ...options,
        headers,
        credentials: 'same-origin',
        cache: 'no-store',
        signal: controller.signal,
        body: options.body === undefined ? undefined : JSON.stringify(options.body)
      });
      const type = response.headers.get('content-type') || '';
      const payload = type.toLowerCase().includes('application/json') ? await response.json().catch(() => ({})) : {};
      if (!response.ok) {
        const error = new Error(payload.error || `Сервер вернул HTTP ${response.status}.`);
        error.status = response.status;
        error.payload = payload;
        throw error;
      }
      return payload;
    } catch (error) {
      if (timedOut && !externalSignal?.aborted) {
        throw new Error(`Время ожидания ответа сервера истекло (${Math.round(this.timeoutMs / 1000)} с). Проверь подключение и повтори действие.`, { cause: error });
      }
      throw error;
    } finally {
      clearTimeout(timeout);
      externalSignal?.removeEventListener('abort', abortFromCaller);
    }
  }
}
