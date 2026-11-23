import { ApiAdapter } from './api-adapter.js';
function readCookie(name) {
  const prefix = `${name}=`;
  return document.cookie.split(';').map(part => part.trim()).find(part => part.startsWith(prefix))?.slice(prefix.length) || '';
}
export class AuthAdapter {
  constructor(api = new ApiAdapter()) { this.api = api; this.user = null; }
  csrfHeaders() {
    const csrf = readCookie('QWEMU_CSRF');
    if (!csrf) throw new Error('Защитный CSRF-токен отсутствует. Обнови страницу и повтори действие.');
    return { 'X-QWEMU-CSRF': csrf };
  }
  async restore() {
    try { const result = await this.api.request('/api/me'); this.user = result.user || null; return this.user; }
    catch (error) { if (error.status === 401) { this.user = null; return null; } throw error; }
  }
  async login(username, password) {
    const result = await this.api.request('/api/auth/login', { method: 'POST', body: { username, password } });
    this.user = result.user; return this.user;
  }
  async register(data) {
    const result = await this.api.request('/api/auth/register', { method: 'POST', body: data });
    this.user = result.user; return this.user;
  }
  async logout() {
    await this.api.request('/api/auth/logout', { method: 'POST', headers: this.csrfHeaders(), body: {} });
    this.user = null;
  }
  async updateProfile(data) {
    const result = await this.api.request('/api/me', { method: 'PUT', headers: this.csrfHeaders(), body: data });
    this.user = result.user; return this.user;
  }
}
