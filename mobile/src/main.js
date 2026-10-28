import { Capacitor, CapacitorHttp, registerPlugin } from '@capacitor/core';
import './style.css';
const Tracking = registerPlugin('AttendanceTracking');
const AdminReports = registerPlugin('AdminReports');
let adminReport, adminReportDate='current', adminEmployee='', adminReportOnline=false, adminAlerts={};
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
  if(response.status>=400){const error=new Error(response.data?.error||'تعذر الاتصال بالخادم');error.status=response.status;throw error;}return response.data;
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
function adminBody(){
  const rows=(adminReport?.reports||[]).filter(r=>!adminEmployee||r.user.id===Number(adminEmployee));
  return `<section class="card"><h1>إدارة جو ستور</h1><p>كل أدوات الموظفين والفروع والكروت والتاجات والتقارير.</p><button id="admin">فتح لوحة الإدارة الكاملة</button><p class="message" role="status">${escape(message)}</p></section>
    <section class="card"><h2>إشعارات التقارير التلقائية</h2><p>${adminAlerts.enabled?(adminAlerts.permission?'التنبيهات مفعّلة':'الإشعارات مقفولة من إعدادات الهاتف'):'التنبيهات غير مفعّلة'}</p>
    <p>التقرير التالي: ${escape(timeLabel(adminAlerts.nextDue||null))}</p><p>آخر مزامنة للتنبيهات: ${escape(timeLabel(adminAlerts.lastSync||null))}</p>
    ${Capacitor.getPlatform()==='android'?`<button id="alerts">${adminAlerts.enabled?'إيقاف التنبيهات':'تفعيل إشعارات التقارير'}</button><button id="test-alert" class="secondary">تجربة إشعار على هذا الهاتف</button>`:'<p>تنبيهات هذه النسخة متاحة على Android.</p>'}
    <p class="hint">من غير ما تفتح اللوحة: كل يوم الساعة 1 صباحًا بتوقيت القاهرة يوصل PDF بساعات حضور كل موظف. كل سبت الساعة 1 صباحًا يوصل تقرير الأسبوع (سبت–جمعة، يوم بيوم). أول كل شهر الساعة 1 صباحًا يوصل تقرير الشهر السابق. الملفات تتحفظ في Downloads والإشعار يفتحها. كمان في تنبيه بعد نهاية شيفت كل موظف. الإنترنت وإذن الإشعارات مطلوبان؛ البطارية قد تؤخر الوصول، ولو النت قطع نلحق التقارير خلال آخر أسبوع بعد رجوعه.</p><p class="message">${escape(adminAlerts.error)}</p></section>
    <section class="card"><h2>التقرير اليومي</h2><p>${adminReportOnline?'بيانات من السيرفر':'آخر بيانات محفوظة، وليست حالة لحظية'} · ${escape(timeLabel(adminReport?.generatedAt))}</p>
      <label>يوم العمل<input id="report-date" type="date" value="${escape(adminReport?.businessDay||'')}"/></label><button id="report-today" class="secondary">يوم العمل الحالي</button><button id="report-last" class="secondary">آخر يوم مكتمل</button>
      <label>الموظف<select id="report-employee"><option value="">كل الموظفين</option>${(adminReport?.reports||[]).map(r=>`<option value="${r.user.id}" ${adminEmployee===String(r.user.id)?'selected':''}>${escape(r.user.name)}</option>`).join('')}</select></label>
      <p class="hint">الحضور والانصراف بالكارت. آخر ظهور للتاج لا يُعتبر انصرافًا.</p></section>
    ${rows.map(r=>`<section class="card"><h2>${escape(r.user.name)}</h2><p>الشيفت: ${escape(timeLabel(r.scheduledShiftStart))} ← ${escape(timeLabel(r.scheduledShiftEnd))}</p>
      <p>حضور الكارت: ${escape(timeLabel(r.firstArrival))}</p><p>انصراف الكارت: ${escape(r.lastDeparture?timeLabel(r.lastDeparture):'لم يسجل انصرافًا')}</p><p>آخر ظهور للتاج: ${escape(timeLabel(r.lastTagSeen))}</p>
      <div class="metrics">${[['التاج مرصود',r.ble_summary?.observed_seconds],['غير مرصود للمراجعة',r.ble_summary?.not_seen_seconds],['الرصد غير معلوم',r.ble_summary?.unknown_seconds],['فترة متابعة الكارت',r.ble_summary?.session_seconds]].map(([label,value])=>`<div><small>${label}</small><strong>${escape(duration(value))}</strong></div>`).join('')}</div>
      <p>${r.missingCheckout?'انصراف ناقص؛ توقفت المتابعة عند الحد المحدد':r.firstArrival&&!r.lastDeparture?'لا توجد قراءة انصراف؛ التقرير يُحدَّث عند وصولها':'أوقات الكارت من القراءات الفعلية'}</p>
      <details><summary>تفاصيل كل فرع</summary>${(r.ble_branches||[]).map(b=>`<p>${escape(b.name)}: مرصود ${escape(duration(b.observed_seconds))} · غير مرصود ${escape(duration(b.not_seen_seconds))} · غير معلوم ${escape(duration(b.unknown_seconds))}</p>`).join('')}<p>إجمالي الفروع يحسب الوقت المتداخل مرة واحدة.</p></details>
    </section>`).join('')||'<section class="card">حدّث التقرير عند توفر الإنترنت.</section>'}`;
}
async function loadAdmin(token,epoch){
  const owner=state.user.id;
  if(Capacitor.getPlatform()==='android'){try{const target=await AdminReports.launch();if(target.day){adminReportDate=target.day;adminEmployee=String(target.employee||'');}adminAlerts=await AdminReports.status();}catch{}}
  const selected=adminReportDate;
  const backgroundReport=adminAlerts.cachedReport;
  adminReport=backgroundReport&&(selected==='current'||selected===backgroundReport.businessDay)?backgroundReport:cached(`admin-report-${selected}`,owner);adminReportOnline=false;
  const data=await request('/api/attendance/day-close'+(selected?'?date='+encodeURIComponent(selected):''),null,token);
  if(epoch!==sessionEpoch||state.user?.id!==owner||selected!==adminReportDate)return;
  adminReport=data;adminReportOnline=true;saveCached(`admin-report-${selected}`,owner,data);
}
function draw(){
  if(!state?.user){
    app.innerHTML=`<section class="hero"><span class="logo">✓</span><p>جو ستور · إدارة الحضور</p><h1>${state?.adminOnly?'إدارة الموظفين<br/>وتقارير الشيفت.':'حضورك وحالة<br/>متابعة الشيفت.'}</h1><p>${state?.adminOnly?'تطبيق المدير؛ تقارير PDF يومية وأسبوعية وشهرية تصل تلقائيًا، مع تنبيه نهاية شيفت كل موظف.':'الحضور بالكارت، ومتابعة الفرع بالتاج أو مصدر الموقع المحدد لحسابك.'}</p></section><section class="card"><h2>تسجيل الدخول</h2><form id="login"><label>اسم المستخدم<input name="username" autocomplete="username" required/></label><label>كلمة المرور<input name="password" type="password" autocomplete="current-password" required/></label><button ${working?'disabled':''}>${working?'جاري الدخول…':'دخول'}</button></form><p class="message" role="status">${escape(message)}</p></section>`;
    app.querySelector('#login').onsubmit=async event=>{
      event.preventDefault();const data=new FormData(event.target);working=true;sessionEpoch++;
      try{const login=await request('/api/auth/login',{username:data.get('username'),password:data.get('password'),adminOnly:state?.adminOnly===true});await Tracking.configure({token:login.token,user:JSON.stringify(login.user)});state=await Tracking.status();summary=cached('summary',state.user.id);presence=cached('presence',state.user.id);presenceOnline=false;message='';await refresh();}
      catch(error){message=error.message;}finally{working=false;draw();}
    };return;
  }
  const employee=state.user.role==='employee',mode=presence?.tracking_mode||(state.trackingSource==='ble'?'ble':'unknown');
  app.innerHTML=`<header><span class="logo small">✓</span><div><small>حضور جو ستور · بتوقيت القاهرة</small><h2>${escape(state.user.name)}</h2></div></header>
    <div class="connection"><span>${employee?mode==='ble'?'التاج يتابع من قارئ الفرع':mode==='unknown'?'مصدر المتابعة لم يتحدث بعد':state.tracking?'GPS نشط خلال حضور الكارت':'متابعة موقع الهاتف':'حساب المدير'}</span><strong>${state.pending} أحداث سابقة محفوظة على الهاتف</strong></div>
    ${employee?(mode==='ble'?bleBody():mode==='gps'?gpsBody():'<section class="card"><h2>تحديث مصدر المتابعة</h2><p>اتصل بالإنترنت وحدّث البيانات لمعرفة هل حسابك يستخدم التاج أو موقع الهاتف.</p></section>'):adminBody()}
    <button id="sync" class="secondary" ${working?'disabled':''}>مزامنة وتحديث</button><button id="renew" class="secondary">تجديد تسجيل الدخول</button><button id="logout" class="secondary">تسجيل الخروج</button>`;
  const toggle=app.querySelector('#toggle');if(toggle)toggle.onclick=async()=>{
    working=true;draw();try{if(state.active)await Tracking.stop();else await Tracking.start();state=await Tracking.status();message=state.active?'GPS جاهز بعد حضور الكارت':'تم إيقاف موقع الهاتف';}
    catch(error){message=error.message;}finally{working=false;draw();}void refresh();
  };
  app.querySelector('#sync').onclick=async()=>{try{await Tracking.sync();await refresh();message=presenceOnline?'تم تحديث البيانات من السيرفر':'تعذر التحديث؛ المعروض آخر بيانات محفوظة';}catch(error){message=error.message;}draw();};
  app.querySelector('#logout').onclick=async()=>{sessionEpoch++;try{await Tracking.logout();state=await Tracking.status();summary=null;presence=null;adminReport=null;adminAlerts={};adminReportOnline=false;presenceOnline=false;message='';}catch(error){message=error.message;}draw();};
  app.querySelector('#renew').onclick=()=>{sessionEpoch++;state={...state,user:null};presenceOnline=false;message='سجل الدخول بنفس الحساب للحفاظ على الأحداث السابقة';draw();};
  const admin=app.querySelector('#admin');if(admin)admin.onclick=async()=>{try{await Tracking.openAdmin();}catch(error){message=error.message;draw();}};
  const alerts=app.querySelector('#alerts');if(alerts)alerts.onclick=async()=>{try{if(adminAlerts.enabled)await AdminReports.disable();else await AdminReports.enable();adminAlerts=await AdminReports.status();message=adminAlerts.enabled?'تم تفعيل إشعارات التقارير التلقائية':'تم إيقاف التنبيهات';}catch(e){message=e.message;}draw();};
  const testAlert=app.querySelector('#test-alert');if(testAlert)testAlert.onclick=async()=>{try{await AdminReports.test();message='تم إرسال إشعار اختبار على الهاتف';}catch(e){message=e.message;}draw();};
  const reportDate=app.querySelector('#report-date');if(reportDate)reportDate.onchange=()=>{adminReportDate=reportDate.value;adminReport=null;void refresh();};
  const employeeFilter=app.querySelector('#report-employee');if(employeeFilter)employeeFilter.onchange=()=>{adminEmployee=employeeFilter.value;draw();};
  const reportToday=app.querySelector('#report-today');if(reportToday)reportToday.onclick=()=>{adminReportDate='current';adminReport=null;void refresh();};
  const reportLast=app.querySelector('#report-last');if(reportLast)reportLast.onclick=()=>{adminReportDate='';adminReport=null;void refresh();};
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
      if(state.adminOnly&&identity.user.role!=='admin'){const owner=state.user.id;for(const key of Object.keys(localStorage))if(key.startsWith('admin-report-')&&key.endsWith('-'+owner))localStorage.removeItem(key);await Tracking.logout();state=await Tracking.status();adminReport=null;adminAlerts={};message='هذا التطبيق مخصص لحساب مدير نشط';draw();return;}
      if(['username','name','phone','role','shift_start','shift_end','is_active'].some(key=>state.user[key]!==identity.user[key])){await Tracking.configure({token,user:JSON.stringify(identity.user)});state=await Tracking.status();}
      if(state.user.role==='employee'){
        const schedule=await request('/api/attendance/tracking-window',null,token);if(epoch!==sessionEpoch)return;await Tracking.setSchedule({schedule:JSON.stringify(schedule)});
        const nextPresence=await request('/api/ble/self',null,token);if(epoch!==sessionEpoch)return;presence=nextPresence;presenceOnline=true;saveCached('presence',state.user.id,presence);
        if(presence.tracking_mode==='ble'&&state.active)await Tracking.stop();
        if(presence.tracking_mode!=='ble'){
          const data=await request('/api/attendance/report',null,token);if(epoch!==sessionEpoch)return;
          if(data.settings.attendance_reset_at)await Tracking.resetEpoch({resetAt:data.settings.attendance_reset_at});summary=data.reports?.[0];saveCached('summary',state.user.id,summary);
        }
      }else{summary=null;presence=null;await loadAdmin(token,epoch);presenceOnline=true;}
    }catch(error){if(epoch===sessionEpoch){presenceOnline=false;adminReportOnline=false;if(state.user?.role==='admin'&&[401,403].includes(error.status)){const owner=state.user.id;for(const key of Object.keys(localStorage))if(key.startsWith('admin-report-')&&key.endsWith('-'+owner))localStorage.removeItem(key);try{await Tracking.logout();state=await Tracking.status();}catch{}adminReport=null;adminAlerts={};message='سجل الدخول بحساب مدير نشط لتجديد الوصول';}}}}
    if(epoch!==sessionEpoch)return;state=await Tracking.status();draw();
  }finally{refreshing=false;}
}
try{await refresh();}catch{app.innerHTML='<section class="card">افتح النسخة المثبتة على Android أو iPhone.</section>';}
setInterval(()=>{if(state?.user&&!working)void refresh();},15000);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&state?.user&&!working)void refresh();});
