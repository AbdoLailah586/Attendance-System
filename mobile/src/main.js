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
let refreshing = false;
let sessionEpoch = 0;
const timeLabel = value => value ? new Date(value).toLocaleString('ar-EG',{timeZone:'Africa/Cairo'}) : '—';
function cachedSummary(id){try{return JSON.parse(localStorage.getItem(`summary-${id}`)||'null');}catch{return null;}}
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
      event.preventDefault();const data = new FormData(event.target);working = true;sessionEpoch++;
      try {
        const login = await request('/api/auth/login', {username:data.get('username'), password:data.get('password')});
        // Tokens are held by native secure storage, never browser localStorage.
        await Tracking.configure({token:login.token, user:JSON.stringify(login.user)});
        state = await Tracking.status(); summary = cachedSummary(state.user.id);message = '';
        await refresh();
      } catch (error) {message = error.message;} finally {working = false;draw();}
    };
    return;
  }
  const s = summary?.summary;
  app.innerHTML = `<header><span class="logo small">📍</span><div><small>الحضور الذكي · بتوقيت القاهرة</small><h2>${escape(state.user.name)}</h2></div></header>
    <div class="connection"><span>${state.tracking?'متابعة الموقع نشطة خلال حضور الكارت':state.active?(state.sessionOpen?'جلسة حضور مفتوحة؛ ننتظر تشغيل الموقع':'التجهيز مفعّل؛ GPS متوقف حتى حضور الكارت'):'التتبع متوقف'}</span><strong>${state.pending} أحداث محفوظة</strong></div>
    <section class="card center"><p>${escape(state.user.shift_start||'10:00')} — ${escape(state.user.shift_end||'22:00')}</p><h1>${'الحضور والانصراف بالكارت'}</h1><p>${escape(state.locationLabel || 'الموقع يُلتقط بعد حضور الكارت')}</p>
      ${state.user.role==='employee'?`<button id="toggle" class="${state.active?'danger':''}" ${working?'disabled':''}>${working?'جاري الحفظ…':state.active?'إيقاف متابعة الموقع':'تجهيز متابعة الموقع بعد حضور الكارت'}</button>`:'<button id="admin">فتح لوحة الأدمين</button>'}
      <button id="sync" class="secondary" ${working?'disabled':''}>مزامنة وتحديث</button><p class="message" role="status">${escape(message || state.error)}</p></section>
    <section class="card"><h3>ملخص اليوم</h3><p>${escape(summary?.punctuality?.message||'الملخص يظهر بعد المزامنة')}</p><div class="metrics">${[['فترة الكارت المكتملة',s?.cardFormatted],['داخل الفروع حسب GPS',s?.totalFormatted],['إضافي بعد الشيفت',s?.overtimeFormatted],['خارج الفروع',s?.outsideFormatted],['فجوات التتبع',s?.unknownFormatted]].map(([name,value])=>`<div><small>${name}</small><strong>${escape(value||'—')}</strong></div>`).join('')}</div></section>
    ${state.user.role==='employee'?`<section class="card"><h3>حالة الهاتف والمزامنة</h3><p>آخر عينة موقع: ${escape(timeLabel(state.lastPingAt))}</p><p>آخر رفع للأحداث: ${escape(timeLabel(state.lastSyncAt))}</p><p>دقة آخر عينة: ${state.lastPingAt?escape(Math.round(state.accuracy))+' متر':'—'}</p><p>حد جلسة التتبع الحالية: ${escape(timeLabel(state.trackingUntil))}</p><button id="settings" class="secondary">إعدادات صلاحيات الهاتف والبطارية</button><p>فعّل الموقع الدقيق والإشعارات، واختر استخدام بطارية غير مقيّد لهذا التطبيق إذا كان هاتفك يوقف الخدمة في الخلفية.</p></section>`:''}
    <section class="note">الحضور والانصراف الأساسيان بالكارت في الفرع. GPS يبدأ بعد وصول حضور الكارت ويتوقف عند وصول انصرافه أو الحد الأقصى بالساعات. الكارت وحده لا يثبت وجودك؛ الموقع غير المتاح يُحسب فجوة تتبع. ساعات الشيفت المفتوح تنتظر قراءة الانصراف. على iPhone افتح التطبيق وفعّل المتابعة قبل مسح الكارت؛ النظام لا يضمن تشغيل تطبيق مغلق تلقائيًا. اسمح بالموقع الدقيق، وعلى iPhone اختر «دائمًا» للاستمرار في الخلفية. لو التطبيق اتقفل إجباريًا أو الجهاز اتطفى، افتحه تاني لاستكمال التتبع.</section><button id="renew" class="secondary">تجديد تسجيل الدخول</button><button id="logout" class="secondary">تسجيل الخروج</button>`;
  const toggle = app.querySelector('#toggle');
  if (toggle) toggle.onclick = async () => {
    working=true;draw();
    try {if(state.active)await Tracking.stop();else await Tracking.start();state=await Tracking.status();message=state.active?'المتابعة جاهزة؛ GPS يبدأ بعد وصول حضور الكارت':'تم إيقاف الموقع؛ سجّل الانصراف بالكارت';}
    catch(error){message=error.message;}finally{working=false;draw();}
    void refresh();
  };
  app.querySelector('#sync').onclick=async()=>{try{await Tracking.sync();await refresh();message='تم تحديث حالة المزامنة';}catch(error){message=error.message;}draw();};
  app.querySelector('#logout').onclick=async()=>{sessionEpoch++;try{await Tracking.logout();state=await Tracking.status();summary=null;message='';}catch(error){message=error.message;}draw();};
  app.querySelector('#renew').onclick=()=>{sessionEpoch++;state={...state,user:null};message='سجل الدخول بنفس الحساب للاحتفاظ بالشيفت والأحداث';draw();};
  const admin=app.querySelector('#admin');if(admin)admin.onclick=async()=>{try{await Tracking.openAdmin();}catch(error){message=error.message;draw();}};
  const settings=app.querySelector('#settings');if(settings)settings.onclick=async()=>{try{await Tracking.openSettings();}catch{message='افتح إعدادات الهاتف ثم التطبيقات ثم حضور جو ستور';draw();}};
}
async function refresh() {
  if(refreshing)return;
  refreshing=true;const epoch=sessionEpoch;
  try{
  state = await Tracking.status();
  if(epoch!==sessionEpoch)return;
  if(state.user)summary=cachedSummary(state.user.id);
  draw(); // Cached identity/report stays usable immediately when offline.
  if(state.user) await Tracking.sync();
  if (state.user) {
    try {
      const {token}=await Tracking.session();
      const identity=await request('/api/auth/me',null,token);
      if(epoch!==sessionEpoch)return;
      if(['username','name','phone','role','shift_start','shift_end','is_active'].some(key=>state.user[key]!==identity.user[key])){
        await Tracking.configure({token,user:JSON.stringify(identity.user)});state=await Tracking.status();
      }
      if(state.user.role==='employee'){
        const schedule=await request('/api/attendance/tracking-window',null,token);if(epoch!==sessionEpoch)return;await Tracking.setSchedule({schedule:JSON.stringify(schedule)});
        const data=await request('/api/attendance/report',null,token);
        if(epoch!==sessionEpoch)return;
        if(data.settings.attendance_reset_at){await Tracking.resetEpoch({resetAt:data.settings.attendance_reset_at});state=await Tracking.status();}
        summary=data.reports?.[0];localStorage.setItem(`summary-${state.user.id}`,JSON.stringify(summary));
      }else{summary=null;}
    }
    catch {if(epoch===sessionEpoch&&state.user)summary=cachedSummary(state.user.id);}
  }
  if(epoch!==sessionEpoch)return;
  state=await Tracking.status();
  draw();
  }finally{refreshing=false;}
}
try { await refresh(); } catch { app.innerHTML='<section class="card">افتح النسخة المثبتة على Android أو iPhone.</section>'; }
setInterval(()=>{if(state?.user&&!working)void refresh();},15000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state?.user&&!working)void refresh();});
