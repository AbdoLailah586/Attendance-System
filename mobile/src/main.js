import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import './style.css';
const Tracking = registerPlugin('AttendanceTracking');
const API = 'https://attendance-system-joe-2026.vercel.app';
const app = document.getElementById('app');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state;
let summary;
let message = '';
let working = false;
async function request(path, data, token) {
  const options = { url: API + path, headers: { 'Content-Type':'application/json', ...(token ? {Authorization:`Bearer ${token}`} : {}) }, connectTimeout:15000, readTimeout:20000 };
  const response = data ? await CapacitorHttp.post({...options, data}) : await CapacitorHttp.get(options);
  if (response.status >= 400) throw new Error(response.data?.error || 'تعذر الاتصال بالخادم');
  return response.data;
}
function draw() {
  if (!state?.user) {
    app.innerHTML = `<section class="hero"><span class="logo">📍</span><p>جو ستور · إدارة الحضور</p><h1>كل شيفت<br/>محسوب بدقة.</h1><p>حضورك وحركتك محفوظين على الهاتف حتى لو النت قطع.</p></section><section class="card"><h2>تسجيل الدخول</h2><form id="login"><label>اسم المستخدم<input name="username" autocomplete="username" required/></label><label>كلمة المرور<input name="password" type="password" autocomplete="current-password" required/></label><button ${working?'disabled':''}>${working?'جاري الدخول…':'دخول'}</button></form><p class="message" role="status">${escape(message)}</p></section>`;
    app.querySelector('#login').onsubmit = async event => {
      event.preventDefault();const data = new FormData(event.target);working = true;
      try {
        const login = await request('/api/auth/login', {username:data.get('username'), password:data.get('password')});
        // Tokens are held by native secure storage, never browser localStorage.
        await Tracking.configure({token:login.token, user:JSON.stringify(login.user)});
        state = await Tracking.status(); message = '';
        await refresh();
      } catch (error) {message = error.message;} finally {working = false;draw();}
    };
    return;
  }
  const s = summary?.summary;
  app.innerHTML = `<header><span class="logo small">📍</span><div><small>الحضور الذكي · بتوقيت القاهرة</small><h2>${escape(state.user.name)}</h2></div></header>
    <div class="connection"><span>${state.active?'التتبع أثناء الشيفت مفعّل':'التتبع متوقف'}</span><strong>${state.pending} أحداث محفوظة</strong></div>
    <section class="card center"><p>${escape(state.user.shift_start||'10:00')} — ${escape(state.user.shift_end||'22:00')}</p><h1>${state.active?'الشيفت شغّال':'ابدأ يومك'}</h1><p>${escape(state.locationLabel || 'الموقع يُلتقط أثناء الشيفت')}</p>
      ${state.user.role==='employee'?`<button id="toggle" class="${state.active?'danger':''}" ${working?'disabled':''}>${working?'جاري الحفظ…':state.active?'إنهاء الشيفت وتسجيل انصراف':'بدء الشيفت وتسجيل حضور'}</button>`:'<button id="admin">فتح لوحة الأدمين</button>'}
      <button id="sync" class="secondary" ${working?'disabled':''}>مزامنة وتحديث</button><p class="message" role="status">${escape(message || state.error)}</p></section>
    <section class="card"><h3>ملخص اليوم</h3><p>${escape(summary?.punctuality?.message||'الملخص يظهر بعد المزامنة')}</p><div class="metrics">${[['حضور داخل الفروع',s?.totalFormatted],['إضافي بعد الشيفت',s?.overtimeFormatted],['خارج الفروع',s?.outsideFormatted],['فجوات التتبع',s?.unknownFormatted]].map(([name,value])=>`<div><small>${name}</small><strong>${escape(value||'—')}</strong></div>`).join('')}</div></section>
    <section class="note">عند بدء الشيفت، يستخدم التطبيق موقعك في الخلفية لتحديد الفرع وحساب الحضور والخروج. ينتهي جمع الموقع عند تسجيل الانصراف. اسمح بالموقع الدقيق، وعلى iPhone اختر «دائمًا» للاستمرار في الخلفية. لو التطبيق اتقفل إجباريًا أو الجهاز اتطفى، افتحه تاني لاستكمال التتبع.</section><button id="renew" class="secondary">تجديد تسجيل الدخول</button><button id="logout" class="secondary">تسجيل الخروج</button>`;
  const toggle = app.querySelector('#toggle');
  if (toggle) toggle.onclick = async () => {
    working=true;draw();
    try {if(state.active)await Tracking.stop();else await Tracking.start();state=await Tracking.status();message=state.active?'تم بدء الشيفت وحفظ الحدث':'تم حفظ الانصراف وإيقاف جمع الموقع';}
    catch(error){message=error.message;}finally{working=false;draw();}
    void refresh();
  };
  app.querySelector('#sync').onclick=async()=>{try{await Tracking.sync();await refresh();message='تم تحديث حالة المزامنة';}catch(error){message=error.message;}draw();};
  app.querySelector('#logout').onclick=async()=>{try{await Tracking.logout();state=await Tracking.status();summary=null;message='';}catch(error){message=error.message;}draw();};
  app.querySelector('#renew').onclick=()=>{state={...state,user:null};message='سجل الدخول بنفس الحساب للاحتفاظ بالشيفت والأحداث';draw();};
  const admin=app.querySelector('#admin');if(admin)admin.onclick=()=>void Tracking.openAdmin();
}
async function refresh() {
  state = await Tracking.status();
  if(state.user) await Tracking.sync();
  if (state.user?.role === 'employee') {
    try {const {token}=await Tracking.session();const data=await request('/api/attendance/report',null,token);summary=data.reports?.[0];localStorage.setItem(`summary-${state.user.id}`,JSON.stringify(summary));}
    catch {const cached=localStorage.getItem(`summary-${state.user.id}`);if(cached)summary=JSON.parse(cached);}
  }
  draw();
}
try { await refresh(); } catch { app.innerHTML='<section class="card">افتح النسخة المثبتة على Android أو iPhone.</section>'; }
setInterval(()=>{if(state?.user&&!working)void refresh();},15000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state?.user&&!working)void refresh();});
