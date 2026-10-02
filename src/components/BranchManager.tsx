'use client';
import { useEffect,useState } from 'react';
import { Branch } from '@/lib/geo';
import AttendanceMap from './AttendanceMap';
export default function BranchManager({onSaved}:{onSaved:()=>void}) {
  const [branches,setBranches]=useState<Branch[]>([]);
  const [selected,setSelected]=useState('branch1');
  const [message,setMessage]=useState('');
  const [busy,setBusy]=useState(false);
  const [mapsLink,setMapsLink]=useState('');
  useEffect(()=>{fetch('/api/settings').then(r=>r.json()).then(d=>setBranches(d.settings?.branches||[])).catch(()=>setMessage('تعذر تحميل الفروع'));},[]);
  const edit=(id:string,patch:Partial<Branch>)=>setBranches(list=>list.map(b=>b.id===id?{...b,...patch}:b));
  const save=async()=>{
    setBusy(true);setMessage('');
    try{const res=await fetch('/api/branches',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({branches})});const data=await res.json();if(!res.ok)throw new Error(data.error);setBranches(data.settings.branches);setMessage('تم حفظ مواقع الفروع');onSaved();}
    catch(e){setMessage(e instanceof Error?e.message:'تعذر الحفظ');}finally{setBusy(false);}
  };
  if(branches.length<2)return <p>{message||'جاري تحميل الفروع…'}</p>;
  return <section className="card" style={{marginBottom:20}}><div className="section-title"><h3>كل الفروع · تحديد الموقع على الخريطة</h3><button className="btn btn-secondary" onClick={()=>{const id=`branch-${crypto.randomUUID().slice(0,8)}`;setBranches(list=>[...list,{id,name:'فرع جديد',lat:branches[0].lat,lng:branches[0].lng,radius:50}]);setSelected(id);}}>إضافة فرع</button></div>
    <p className="muted">اختار الفرع، ثم اضغط مكانه على الخريطة وعدّل نطاق GPS. التغييرات تُطبق بعد الحفظ.</p>
    <select aria-label="الفرع المراد تحديد موقعه" className="form-input" value={selected} onChange={e=>setSelected(e.target.value)}>{branches.map(b=><option key={b.id} value={b.id}>{b.name}</option>)}</select>
    <div className="section-title"><a className="btn btn-secondary" href={`https://www.google.com/maps/search/?api=1&query=${branches.find(b=>b.id===selected)?.lat},${branches.find(b=>b.id===selected)?.lng}`} target="_blank" rel="noopener noreferrer">فتح مكان الفرع في Google Maps</a></div>
    <label>رابط Google Maps بإحداثيات ظاهرة<input aria-label="رابط Google Maps" className="form-input" dir="ltr" value={mapsLink} onChange={e=>setMapsLink(e.target.value)} placeholder="https://www.google.com/maps/@30.0444,31.2357,17z"/></label>
    <button className="btn btn-secondary" onClick={()=>{const coordinates=mapsLink.match(/(?:@|[?&]q=|query=|!3d)(-?\d+(?:\.\d+)?)(?:,|%2C|!4d)(-?\d+(?:\.\d+)?)/i);if(!coordinates){setMessage('استخدم الرابط الكامل الذي يحتوي على Latitude وLongitude؛ الروابط المختصرة تحتاج فتحها أولًا');return;}edit(selected,{lat:Number(coordinates[1]),lng:Number(coordinates[2])});setMessage('تم اختيار الموقع؛ اضغط حفظ لتطبيقه');}}>تطبيق موقع الرابط</button>
    <AttendanceMap branch1={branches[0]} branch2={branches[1]} branches={branches} isEditing activeEditingBranch={selected} onBranchLocationSelected={(id,lat,lng)=>edit(id,{lat,lng})}/>
    {branches.map(b=><div className="metrics-grid" key={b.id}><label>اسم الفرع<input aria-label={`اسم ${b.id}`} className="form-input" value={b.name} onChange={e=>edit(b.id,{name:e.target.value})}/></label><label>نطاق GPS بالمتر<input aria-label={`نطاق ${b.id}`} type="number" min={10} max={5000} className="form-input" value={b.radius} onChange={e=>edit(b.id,{radius:Number(e.target.value)})}/></label><label>Latitude<input aria-label={`Latitude ${b.id}`} className="form-input" type="number" step="any" value={b.lat} onChange={e=>edit(b.id,{lat:Number(e.target.value)})}/></label><label>Longitude<input aria-label={`Longitude ${b.id}`} className="form-input" type="number" step="any" value={b.lng} onChange={e=>edit(b.id,{lng:Number(e.target.value)})}/></label>{!['branch1','branch2'].includes(b.id)&&<button className="btn btn-secondary" onClick={()=>{setBranches(list=>list.filter(item=>item.id!==b.id));setSelected('branch1');}}>إلغاء الفرع</button>}</div>)}
    <button className="btn btn-primary" disabled={busy} onClick={()=>void save()}>{busy?'جاري الحفظ…':'حفظ كل الفروع'}</button>{message&&<p role="status">{message}</p>}
  </section>;
}
