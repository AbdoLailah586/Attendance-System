import { CapacitorHttp, registerPlugin } from '@capacitor/core';
import './style.css';
const Tracking = registerPlugin('AttendanceTracking');
const API = 'https://attendance-system-joe-2026.vercel.app';
const app = document.getElementById('app');
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let state, summary, presence;
let presenceOnline = false;
let message = '', working = false, refreshing = false, sessionEpoch = 0;
const timeLabel = value => value ? new Date(value).toLocaleString('ar-EG', {timeZone:'Africa/Cairo'}) : '—';
const duration = seconds => {const n=Math.max(0,Math.floor(Number(seconds)||0));return `${Math.floor(n/3600)} س ${Math.floor(n%3600/60)} د ${n%60} ث`;};
function cached(key,id) {try{return JSON.parse(localStorage.getItem(`${key}-${id}`)||'null');}catch{return null;}}
function saveCached(key,id,value) {try{localStorage.setItem(`${key}-${id}`,JSON.stringify(value));}catch{}}
async function request(path,data,token) {
  const options={url:API+path,headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},connectTimeout:15000,readTimeout:20000};
  const response=data?await CapacitorHttp.post({...options,data}):await CapacitorHttp.get(options);
  if(response.status>=400)throw new Error(response.data?.error||'تعذر الاتصال بالخادم');return response.data;
}
const stateLabels={seen:'التاج مرصود',not_seen:'التاج غير مرصود · للمراجعة',unknown:'الرصد غير معلوم',off_shift:'المتابعة متوقفة خارج جلسة الحضور'};
const healthLabels={ready:'القارئ يعمل',fault:'عطل في القارئ',stale:'اتصال القارئ غير محدّث',disabled:'القارئ معطّل',unconfigured:'رصد البلوتوث غير مجهّز'};
function freshPresence(){return presenceOnline&&presence?.server_time&&Math.abs(Date.now()-Date.parse(presence.server_time))<90000;}
function bleBody(){
  const fresh=freshPresence(),observed=fresh?presence.state:'unknown',total=presence?.summary,session=presence?.session;
  return `<section class="card center status-${escape(observed)}"><small>المتابعة عن طريق تاج الفرع</small><h1>${escape(stateLabels[observed]||stateLabels.unknown)}</h1>
    <p>${escape(fresh?(presence.branch_name||'لا يوجد فرع مرصود حاليًا'):'البيانات المحفوظة لا تثبت الحالة الحالية')}</p>
    <p>آخر رصد للتاج: ${escape(timeLabel(presence?.captured_at))}</p><p>الحضور: ${escape(timeLabel(session?.firstArrival))}</p><p>الانصراف: ${escape(timeLabel(session?.lastDeparture))}</p>
    <p>${session?.missing_checkout?'انصراف ناقص؛ راجع الأدمين':session?.active?'جلسة حضور الكارت مفتوحة':'جلسة الحضور غير مفتوحة الآن'}</p>
    <p>الحد الأقصى للمتابعة: ${escape(timeLabel(session?.until))}</p><p class="message" role="status">${escape(message||state.error)}</p></section>
    <section class="card"><h3>رصد اليوم أثناء جلسة الكارت</h3><p>${fresh?'ملخص من السيرفر':'آخر ملخص محفوظ'} · ${escape(timeLabel(presence?.server_time))}</p>
    <div class="metrics">${[['فترة الكارت',total?.session_seconds],['التاج مرصود',total?.observed_seconds],['غير مرصود للمراجعة',total?.not_seen_seconds],['الرصد غير معلوم',total?.unknown_seconds]].map(([label,value])=>`<div><small>${label}</small><strong>${value==null?'—':escape(duration(value))}</strong></div>`).join('')}</div>
    <p class="hint">إجمالي الفروع يحسب الوقت مرة واحدة عند تداخل الرصد.</p></section>
    <section class="card"><h3>قارئات الفروع</h3>${(presence?.receivers||[]).map(receiver=>`<div class="receiver"><strong>${escape(receiver.branch_name)}</strong><p>${escape(healthLabels[receiver.receiver_state]||healthLabels.unconfigured)}</p><small>آخر اتصال: ${escape(timeLabel(receiver.last_heartbeat))}</small></div>`).join('')||'<p>لا توجد بيانات قارئ محفوظة.</p>'}</section>
    <section class="note">الحضور والانصراف بالكارت، والتاج يتصل مباشرة بقارئ الفرع. لا تحتاج تشغيل موقع الهاتف أو بلوتوثه أو إبقاء التطبيق مفتوحًا لمتابعة التاج. التطبيق يعرض النتائج عند الاتصال بالإنترنت؛ القارئ يحفظ القراءات للمزامنة عند عودته. فقد رصد التاج يحتاج مراجعة، ولا يثبت غياب صاحبه. أوقات «غير معلوم» لا تُعتبر غيابًا مؤكدًا.</section>`;
}
function gpsBody(){
  const s=summary?.summary;
  return `<section class="card center"><small>المتابعة الحالية عن طريق موقع الهاتف</small><h1>الحضور والانصراف بالكارت</h1><p>${escape(state.locationLabel||'الموقع يُلتقط بعد حضور الكارت')}</p>
    <button id="toggle" class="${state.active?'danger':''}" ${working?'disabled':''}>${working?'جاري الحفظ…':state.active?'إيقاف متابعة الموقع':'تجهيز الموقع بعد حضور الكارت'}</button><p class="message" role="status">${escape(message||state.error)}</p></section>
    <section class="card"><h3>ملخص اليوم حسب GPS</h3><p>${escape(summary?.punctuality?.message||'الملخص يظهر بعد المزامنة')}</p><div class="metrics">${[['فترة الكارت المكتملة',s?.cardFormatted],['داخل الفروع حسب GPS',s?.totalFormatted],['إضافي بعد الشيفت',s?.overtimeFormatted],['خارج الفروع حسب GPS',s?.outsideFormatted],['فجوات GPS',s?.unknownFormatted]].map(([label,value])=>`<div><small>${label}</small><strong>${escape(value||'—')}</strong></div>`).join('')}</div></section>
    <section class="card"><h3>حالة الهاتف والمزامنة</h3><p>آخر عينة موقع: ${escape(timeLabel(state.lastPingAt))}</p><p>آخر رفع: ${escape(timeLabel(state.lastSyncAt))}</p><p>دقة العينة: ${state.lastPingAt?escape(Math.round(state.accuracy))+' متر':'—'}</p><button id="settings" class="secondary">إعدادات صلاحيات الهاتف والبطارية</button></section>
    <section class="note">حسابك غير مربوط بتاج نشط، لذلك يستخدم مصدر GPS الحالي. الموقع يبدأ بعد حضور الكارت ويتوقف عند الانصراف أو الحد الأقصى. اسمح بالموقع الدقيق والإشعارات، واضبط البطارية إذا توقف التتبع. على iPhone تحتاج صلاحية «دائمًا» وتشغيل التطبيق قبل تجهيز المتابعة. إغلاق التطبيق إجباريًا أو إطفاء الهاتف قد يوقف GPS.</section>`;
}
function draw(){
  if(!state?.user){
    app.innerHTML=`<section class="hero"><span class="logo">✓</span><p>جو ستور · إدارة الحضور</p><h1>حضورك وحالة<br/>متابعة الشيفت.</h1><p>الحضور بالكارت، ومتابعة الفرع بالتاج أو مصدر الموقع المحدد لحسابك.</p></section><section class="card"><h2>تسجيل الدخول</h2><form id="login"><label>اسم المستخدم<input name="username" autocomplete="username" required/></label><label>كلمة المرور<input name="password" type="password" autocomplete="current-password" required/></label><button ${working?'disabled':''}>${working?'جاري الدخول…':'دخول'}</button></form><p class="message" role="status">${escape(message)}</p></section>`;
    app.querySelector('#login').onsubmit=async event=>{
      event.preventDefault();const data=new FormData(event.target);working=true;sessionEpoch++;
      try{const login=await request('/api/auth/login',{username:data.get('username'),password:data.get('password')});await Tracking.configure({token:login.token,user:JSON.stringify(login.user)});state=await Tracking.status();summary=cached('summary',state.user.id);presence=cached('presence',state.user.id);presenceOnline=false;message='';await refresh();}
      catch(error){message=error.message;}finally{working=false;draw();}
    };return;
  }
  const employee=state.user.role==='employee',mode=presence?.tracking_mode||(state.trackingSource==='ble'?'ble':'unknown');
  app.innerHTML=`<header><span class="logo small">✓</span><div><small>حضور جو ستور · بتوقيت القاهرة</small><h2>${escape(state.user.name)}</h2></div></header>
    <div class="connection"><span>${employee?mode==='ble'?'التاج يتابع من قارئ الفرع':mode==='unknown'?'مصدر المتابعة لم يتحدث بعد':state.tracking?'GPS نشط خلال حضور الكارت':'متابعة موقع الهاتف':'حساب المدير'}</span><strong>${state.pending} أحداث سابقة محفوظة على الهاتف</strong></div>
    ${employee?(mode==='ble'?bleBody():mode==='gps'?gpsBody():'<section class="card"><h2>تحديث مصدر المتابعة</h2><p>اتصل بالإنترنت وحدّث البيانات لمعرفة هل حسابك يستخدم التاج أو موقع الهاتف.</p></section>'):'<section class="card center"><h1>لوحة الأدمين</h1><p>الموظفون والكروت والتاجات والسجلات والتقارير على المنصة المنشورة.</p><button id="admin">فتح لوحة الأدمين</button></section>'}
    <button id="sync" class="secondary" ${working?'disabled':''}>مزامنة وتحديث</button><button id="renew" class="secondary">تجديد تسجيل الدخول</button><button id="logout" class="secondary">تسجيل الخروج</button>`;
  const toggle=app.querySelector('#toggle');if(toggle)toggle.onclick=async()=>{
    working=true;draw();try{if(state.active)await Tracking.stop();else await Tracking.start();state=await Tracking.status();message=state.active?'GPS جاهز بعد حضور الكارت':'تم إيقاف موقع الهاتف';}
    catch(error){message=error.message;}finally{working=false;draw();}void refresh();
  };
  app.querySelector('#sync').onclick=async()=>{try{await Tracking.sync();await refresh();message=presenceOnline?'تم تحديث البيانات من السيرفر':'تعذر التحديث؛ المعروض آخر بيانات محفوظة';}catch(error){message=error.message;}draw();};
  app.querySelector('#logout').onclick=async()=>{sessionEpoch++;try{await Tracking.logout();state=await Tracking.status();summary=null;presence=null;presenceOnline=false;message='';}catch(error){message=error.message;}draw();};
  app.querySelector('#renew').onclick=()=>{sessionEpoch++;state={...state,user:null};presenceOnline=false;message='سجل الدخول بنفس الحساب للحفاظ على الأحداث السابقة';draw();};
  const admin=app.querySelector('#admin');if(admin)admin.onclick=async()=>{try{await Tracking.openAdmin();}catch(error){message=error.message;draw();}};
  const settings=app.querySelector('#settings');if(settings)settings.onclick=async()=>{try{await Tracking.openSettings();}catch{message='افتح إعدادات الهاتف ثم التطبيقات ثم حضور جو ستور';draw();}};
}
async function refresh(){
  if(refreshing)return;refreshing=true;const epoch=sessionEpoch;
  try{
    state=await Tracking.status();if(epoch!==sessionEpoch)return;
    if(state.user){summary=cached('summary',state.user.id);presence=cached('presence',state.user.id);}else{summary=null;presence=null;}
    presenceOnline=false;draw();if(state.user)await Tracking.sync();
    if(state.user){try{
      const {token}=await Tracking.session();const identity=await request('/api/auth/me',null,token);if(epoch!==sessionEpoch)return;
      if(['username','name','phone','role','shift_start','shift_end','is_active'].some(key=>state.user[key]!==identity.user[key])){await Tracking.configure({token,user:JSON.stringify(identity.user)});state=await Tracking.status();}
      if(state.user.role==='employee'){
        const schedule=await request('/api/attendance/tracking-window',null,token);if(epoch!==sessionEpoch)return;await Tracking.setSchedule({schedule:JSON.stringify(schedule)});
        const nextPresence=await request('/api/ble/self',null,token);if(epoch!==sessionEpoch)return;presence=nextPresence;presenceOnline=true;saveCached('presence',state.user.id,presence);
        if(presence.tracking_mode==='ble'&&state.active)await Tracking.stop();
        if(presence.tracking_mode!=='ble'){
          const data=await request('/api/attendance/report',null,token);if(epoch!==sessionEpoch)return;
          if(data.settings.attendance_reset_at)await Tracking.resetEpoch({resetAt:data.settings.attendance_reset_at});summary=data.reports?.[0];saveCached('summary',state.user.id,summary);
        }
      }else{summary=null;presence=null;presenceOnline=true;}
    }catch{if(epoch===sessionEpoch)presenceOnline=false;}}
    if(epoch!==sessionEpoch)return;state=await Tracking.status();draw();
  }finally{refreshing=false;}
}
try{await refresh();}catch{app.innerHTML='<section class="card">افتح النسخة المثبتة على Android أو iPhone.</section>';}
setInterval(()=>{if(state?.user&&!working)void refresh();},15000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state?.user&&!working)void refresh();});
