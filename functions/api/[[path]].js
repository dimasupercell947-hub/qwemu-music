const SESSION_COOKIE = 'QWEMU_SESSION';
const CSRF_COOKIE = 'QWEMU_CSRF';
const SESSION_SECONDS = 14 * 24 * 60 * 60;
const MAX_BODY_BYTES = 512 * 1024;
const PASSWORD_ITERATIONS = 310_000;
const encoder = new TextEncoder();

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'same-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'; base-uri 'none'",
    ...extraHeaders
  });
  return new Response(JSON.stringify(data), { status, headers });
}
const fail = (status, message) => json({ error: message }, status);
function randomBytes(size) { const bytes = new Uint8Array(size); crypto.getRandomValues(bytes); return bytes; }
function base64url(bytes) { let raw=''; for (const byte of bytes) raw += String.fromCharCode(byte); return btoa(raw).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''); }
function fromBase64url(value) { const normalized=String(value).replace(/-/g,'+').replace(/_/g,'/'); const padded=normalized.padEnd(Math.ceil(normalized.length/4)*4,'='); const raw=atob(padded); return Uint8Array.from(raw, ch=>ch.charCodeAt(0)); }
async function digest(value) { return base64url(new Uint8Array(await crypto.subtle.digest('SHA-256', typeof value === 'string' ? encoder.encode(value) : value))); }
function parseCookies(header='') { const result={}; for(const part of header.split(';')) { const index=part.indexOf('='); if(index>0)result[part.slice(0,index).trim()]=part.slice(index+1).trim(); } return result; }
function appendCookies(response, values) { const headers=new Headers(response.headers); for(const value of values)headers.append('Set-Cookie',value); return new Response(response.body,{status:response.status,statusText:response.statusText,headers}); }
function sessionCookie(token) { return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_SECONDS}`; }
function csrfCookie(token, maxAge=SESSION_SECONDS) { return `${CSRF_COOKIE}=${token}; Path=/; Secure; SameSite=Lax; Max-Age=${maxAge}`; }
function clearCookie(name, httpOnly=true) { return `${name}=; Path=/; ${httpOnly?'HttpOnly; ':''}Secure; SameSite=Lax; Max-Age=0`; }
async function readJson(request) {
  const contentType=request.headers.get('content-type')||'';
  if(!contentType.toLowerCase().startsWith('application/json'))throw new Error('Ожидается Content-Type: application/json.');
  const length=Number(request.headers.get('content-length')||0);
  if(length>MAX_BODY_BYTES)throw new Error('Размер запроса превышает 512 КиБ.');
  if(!request.body)throw new Error('Тело запроса отсутствует.');
  const reader=request.body.getReader(); const chunks=[]; let size=0;
  try {
    while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;if(size>MAX_BODY_BYTES){await reader.cancel();throw new Error('Размер запроса превышает 512 КиБ.');}chunks.push(value);}
  } finally { reader.releaseLock(); }
  const bytes=new Uint8Array(size);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
  let parsed;try{parsed=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw new Error('Тело запроса должно быть корректным JSON.');}
  if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))throw new Error('Ожидался JSON-объект.');
  return parsed;
}
function validEmail(value) { return value==='' || (value.length<=160 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)); }
function constantTimeEqual(a,b) { if(typeof a!=='string'||typeof b!=='string')return false;let diff=a.length^b.length;const len=Math.max(a.length,b.length);for(let i=0;i<len;i++)diff|=(a.charCodeAt(i)||0)^(b.charCodeAt(i)||0);return diff===0; }
async function derivePassword(password,salt) {
  const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
  const bits=await crypto.subtle.deriveBits({name:'PBKDF2',salt,iterations:PASSWORD_ITERATIONS,hash:'SHA-256'},key,256);
  return base64url(new Uint8Array(bits));
}
async function rateAllowed(request,env,scope) {
  if(!env.DB || typeof env.RATE_LIMIT_SECRET !== 'string' || env.RATE_LIMIT_SECRET.length === 0)throw new Error('Auth backend is not configured.');
  const address=request.headers.get('CF-Connecting-IP')||'unknown';
  const key=await digest(`${env.RATE_LIMIT_SECRET}:${scope}:${address}`);
  const minute=Math.floor(Date.now()/60_000);
  await env.DB.prepare('DELETE FROM rate_limits WHERE window_start < ?').bind(minute-2).run();
  await env.DB.prepare(`INSERT INTO rate_limits(rate_key,window_start,attempts) VALUES(?,?,1)
    ON CONFLICT(rate_key) DO UPDATE SET attempts=CASE WHEN window_start=excluded.window_start THEN attempts+1 ELSE 1 END, window_start=excluded.window_start`).bind(key,minute).run();
  const row=await env.DB.prepare('SELECT attempts FROM rate_limits WHERE rate_key=?').bind(key).first();
  return Number(row?.attempts||0)<=8;
}
function originAllowed(request) {
  const origin=request.headers.get('Origin');
  return Boolean(origin) && origin === new URL(request.url).origin;
}
async function requireCsrf(request,env) {
  if(!originAllowed(request))return {error:fail(403,'Запрос отклонён проверкой источника.')};
  const cookies=parseCookies(request.headers.get('Cookie'));
  const token=cookies[SESSION_COOKIE]||'';const csrf=cookies[CSRF_COOKIE]||'';
  const header=request.headers.get('X-QWEMU-CSRF')||'';
  if(!token||!csrf||!constantTimeEqual(csrf,header))return {error:fail(403,'CSRF-проверка не пройдена. Обнови страницу и повтори действие.')};
  const tokenHash=await digest(token);const csrfHash=await digest(csrf);
  const session=await env.DB.prepare(`SELECT s.user_id,s.csrf_hash,s.expires_at,u.username,u.display_name,u.email
    FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?`).bind(tokenHash,Math.floor(Date.now()/1000)).first();
  if(!session||!constantTimeEqual(session.csrf_hash,csrfHash))return {error:fail(401,'Сессия завершена. Войди снова.')};
  return {session};
}
function publicUser(row) { return {id:row.id,username:row.username,displayName:row.display_name,email:row.email||'',createdAt:row.created_at}; }
async function createSessionRecord(env,userId,now=Math.floor(Date.now()/1000)) {
  const token=base64url(randomBytes(32));
  const csrf=base64url(randomBytes(32));
  const tokenHash=await digest(token);
  const csrfHash=await digest(csrf);
  const statement=env.DB.prepare('INSERT INTO sessions(token_hash,user_id,csrf_hash,created_at,expires_at) VALUES(?,?,?,?,?)')
    .bind(tokenHash,userId,csrfHash,now,now+SESSION_SECONDS);
  return {token,csrf,statement};
}
async function issueSession(env,userId) {
  const now=Math.floor(Date.now()/1000);
  await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
  const record=await createSessionRecord(env,userId,now);
  await record.statement.run();
  return {token:record.token,csrf:record.csrf};
}
function normalizeValue(key,value) {
  if(key==='playlists') {
    if(!Array.isArray(value)||value.length>300)throw new Error('Список плейлистов некорректен или слишком велик.');
    return value.slice(0,300).map(item=>{
      if(!item||typeof item!=='object'||Array.isArray(item))throw new Error('Некорректная запись плейлиста.');
      const id=String(item.id||'').slice(0,80),name=String(item.name||'').trim().slice(0,60);
      if(!id||!name)throw new Error('У каждого плейлиста должны быть ID и название.');
      const trackIds=Array.isArray(item.trackIds)?item.trackIds.slice(0,5000).filter(v=>typeof v==='string').map(v=>v.slice(0,120)):[];
      return {id,name,description:String(item.description||'').slice(0,180),trackIds:[...new Set(trackIds)]};
    });
  }
  if(key==='favorites') {
    if(!Array.isArray(value)||value.length>5000||value.some(v=>typeof v!=='string'))throw new Error('Список избранного некорректен.');
    return [...new Set(value.map(v=>v.slice(0,120)))];
  }
  if(key==='settings') {
    if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Настройки должны быть JSON-объектом.');
    const out={};
    if(typeof value.theme==='string'&&['dark-red','orange-night','midnight','pure-black','light'].includes(value.theme))out.theme=value.theme;
    if(Number.isFinite(value.volume))out.volume=Math.max(0,Math.min(1,value.volume));
    if(typeof value.reducedMotion==='boolean')out.reducedMotion=value.reducedMotion;
    return out;
  }
  throw new Error('Неизвестный тип данных.');
}
async function getUserData(env,userId,key) {
  const row=await env.DB.prepare('SELECT data_json,updated_at FROM user_data WHERE user_id=? AND data_key=?').bind(userId,key).first();
  if(!row)return {value:key==='playlists'||key==='favorites'?[]:{},updatedAt:null};
  try{return {value:JSON.parse(row.data_json),updatedAt:row.updated_at};}catch{return {value:key==='playlists'||key==='favorites'?[]:{},updatedAt:row.updated_at};}
}
async function handle(request,env) {
  const url=new URL(request.url);const path=url.pathname;const method=request.method.toUpperCase();
  if(method==='GET'&&path==='/api/health') {
    if(!env.DB)return fail(503,'D1 database binding не настроен.');
    const rateLimitConfigured = typeof env.RATE_LIMIT_SECRET === 'string' && env.RATE_LIMIT_SECRET.length > 0;
    const rateLimitStrong = rateLimitConfigured
      && encoder.encode(env.RATE_LIMIT_SECRET).byteLength >= 32
      && env.RATE_LIMIT_SECRET === env.RATE_LIMIT_SECRET.trim();
    if(!rateLimitConfigured)return fail(503,'RATE_LIMIT_SECRET не настроен.');
    try {
      await env.DB.prepare('SELECT 1 AS ready').first();
      return json({ok:true,service:'QWEMU Web API',version:'1.4.0',databaseConfigured:true,databaseReady:true,rateLimitConfigured:true,rateLimitStrong});
    } catch {
      return fail(503,'D1 database недоступна.');
    }
  }
  if(!env.DB)return fail(503,'D1 database binding не настроен.');
  if(path==='/api/auth/register'&&method==='POST'||path==='/api/auth/login'&&method==='POST') {
    if(!originAllowed(request))return fail(403,'Запрос отклонён проверкой источника.');
    const kind=path.endsWith('register')?'register':'login';
    let allowed=false;try{allowed=await rateAllowed(request,env,kind);}catch{return fail(503,'Защита авторизации не настроена.');}
    if(!allowed)return fail(429,'Слишком много попыток. Повтори через минуту.');
    let body;try{body=await readJson(request);}catch(error){return fail(400,error.message);}
    const username=String(body.username||'').trim().toLowerCase();const password=String(body.password||'');
    if(kind==='register') {
      const displayName=String(body.displayName||'').trim();const email=String(body.email||'').trim().toLowerCase();
      if(!/^[a-z0-9_]{3,20}$/.test(username))return fail(400,'Логин: 3–20 символов, латиница, цифры и подчёркивание.');
      if(displayName.length<2||displayName.length>32)return fail(400,'Отображаемое имя должно содержать 2–32 символа.');
      if(!validEmail(email))return fail(400,'Проверь адрес электронной почты.');
      if(password.length<8||password.length>128)return fail(400,'Пароль должен содержать 8–128 символов.');
      const salt=randomBytes(16);const hash=await derivePassword(password,salt);const id=crypto.randomUUID();const now=Math.floor(Date.now()/1000);
      await env.DB.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now).run();
      const session=await createSessionRecord(env,id,now);
      try {
        await env.DB.batch([
          env.DB.prepare('INSERT INTO users(id,username,display_name,email,password_salt,password_hash,created_at) VALUES(?,?,?,?,?,?,?)')
            .bind(id,username,displayName,email||null,base64url(salt),hash,now),
          session.statement
        ]);
      } catch(error) {
        const message=String(error?.message||'').toLowerCase();
        if(message.includes('unique constraint')||message.includes('users.username')||message.includes('users.email')) {
          return fail(409,'Имя пользователя или адрес электронной почты уже заняты.');
        }
        throw error;
      }
      const response=json({user:{id,username,displayName,email,createdAt:now}} ,201);
      return appendCookies(response,[sessionCookie(session.token),csrfCookie(session.csrf)]);
    }
    if(username.length>20||password.length<1||password.length>128)return fail(400,'Проверь имя пользователя и пароль.');
    const row=await env.DB.prepare('SELECT id,username,display_name,email,password_salt,password_hash,created_at FROM users WHERE username=? COLLATE NOCASE').bind(username).first();
    const salt=row?fromBase64url(row.password_salt):encoder.encode('QWEMU-invalid-user-dummy-salt');
    const computed=await derivePassword(password,salt);const expected=row?.password_hash||'invalid-user-hash';
    if(!row||!constantTimeEqual(computed,expected))return fail(401,'Неверное имя пользователя или пароль.');
    const session=await issueSession(env,row.id);const response=json({user:publicUser(row)});
    return appendCookies(response,[sessionCookie(session.token),csrfCookie(session.csrf)]);
  }
  if(path==='/api/auth/logout'&&method==='POST') {
    const auth=await requireCsrf(request,env);if(auth.error)return auth.error;
    const token=parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];
    await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await digest(token)).run();
    return appendCookies(json({ok:true}),[clearCookie(SESSION_COOKIE),clearCookie(CSRF_COOKIE,false)]);
  }
  if(path==='/api/me'&&method==='GET') {
    const cookies=parseCookies(request.headers.get('Cookie'));const token=cookies[SESSION_COOKIE];if(!token)return fail(401,'Требуется вход в аккаунт.');
    const row=await env.DB.prepare('SELECT u.id,u.username,u.display_name,u.email,u.created_at,s.csrf_hash,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').bind(await digest(token),Math.floor(Date.now()/1000)).first();
    if(!row)return fail(401,'Сессия завершена. Войди снова.');
    const csrf=cookies[CSRF_COOKIE]||'';if(!csrf||!constantTimeEqual(await digest(csrf),row.csrf_hash))return fail(401,'CSRF-cookie не совпадает с активной сессией. Войди снова.');
    return json({user:publicUser(row)});
  }
  if(path==='/api/me'&&method==='PUT') {
    const auth=await requireCsrf(request,env);if(auth.error)return auth.error;
    let body;try{body=await readJson(request);}catch(error){return fail(400,error.message);}
    const name=String(body.displayName||'').trim();const email=String(body.email||'').trim().toLowerCase();
    if(name.length<2||name.length>32)return fail(400,'Имя должно содержать 2–32 символа.');
    if(!validEmail(email))return fail(400,'Проверь адрес электронной почты.');
    try{await env.DB.prepare('UPDATE users SET display_name=?,email=?,updated_at=? WHERE id=?').bind(name,email||null,Math.floor(Date.now()/1000),auth.session.user_id).run();}
    catch(error){
      const message=String(error?.message||'').toLowerCase();
      if(message.includes('unique constraint')&&message.includes('email'))return fail(409,'Адрес электронной почты уже используется.');
      throw error;
    }
    const row=await env.DB.prepare('SELECT id,username,display_name,email,created_at FROM users WHERE id=?').bind(auth.session.user_id).first();
    return json({user:publicUser(row)});
  }
  const dataKey=path==='/api/playlists'?'playlists':path==='/api/favorites'?'favorites':path==='/api/settings'?'settings':null;
  if(dataKey&&(method==='GET'||method==='PUT')) {
    let session;
    if(method==='GET') {
      const token=parseCookies(request.headers.get('Cookie'))[SESSION_COOKIE];if(!token)return fail(401,'Требуется вход в аккаунт.');
      session=await env.DB.prepare('SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?').bind(await digest(token),Math.floor(Date.now()/1000)).first();
      if(!session)return fail(401,'Сессия завершена. Войди снова.');
    } else {
      const auth=await requireCsrf(request,env);if(auth.error)return auth.error;session=auth.session;
    }
    if(method==='GET')return json(await getUserData(env,session.user_id,dataKey));
    let body;try{body=await readJson(request);}catch(error){return fail(400,error.message);}
    let value;try{value=normalizeValue(dataKey,body.value);}catch(error){return fail(400,error.message);}
    const expectedUpdatedAt=body.expectedUpdatedAt;
    if(expectedUpdatedAt!==null&&(!Number.isSafeInteger(expectedUpdatedAt)||expectedUpdatedAt<0)) {
      return fail(400,'expectedUpdatedAt должен быть целым числом или null.');
    }
    if(!Object.prototype.hasOwnProperty.call(body,'expectedUpdatedAt')) {
      return fail(400,'Для синхронизации требуется версия expectedUpdatedAt.');
    }
    const now=Date.now();
    const result=await env.DB.prepare(`INSERT INTO user_data(user_id,data_key,data_json,updated_at) VALUES(?,?,?,?)
      ON CONFLICT(user_id,data_key) DO UPDATE SET data_json=excluded.data_json,
        updated_at=MAX(excluded.updated_at,user_data.updated_at+1)
      WHERE user_data.updated_at=?`).bind(session.user_id,dataKey,JSON.stringify(value),now,expectedUpdatedAt).run();
    const changed=Number(result?.meta?.changes??result?.changes??0);
    if(changed<1) {
      const current=await getUserData(env,session.user_id,dataKey);
      return json({error:'Данные изменились на другом устройстве. Сравни версии перед синхронизацией.',current},409);
    }
    const saved=await getUserData(env,session.user_id,dataKey);
    return json({ok:true,value:saved.value,updatedAt:saved.updatedAt});
  }
  return fail(404,'API endpoint не найден.');
}

export async function onRequest(context) {
  try { return await handle(context.request,context.env); }
  catch (error) { console.error('QWEMU API request failed:', error instanceof Error ? error.message : String(error)); return fail(500,'Внутренняя ошибка сервиса. Проверь настройки backend и журнал Cloudflare.'); }
}
