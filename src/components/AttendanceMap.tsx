'use client';
import { useEffect, useRef } from 'react';
import type { Map, LayerGroup } from 'leaflet';
import type { Branch } from '@/lib/geo';

interface EmployeeMarker { id:number; name:string; lat:number; lng:number; branch_id:string; isOnline:boolean; distance1:number; distance2:number }
interface Props {
  branch1: Omit<Branch,'id'>; branch2: Omit<Branch,'id'>; branches?: Branch[];
  employees?: EmployeeMarker[]; isEditing?:boolean; activeEditingBranch?:string|null;
  onLocationSelected?:(branch:'branch1'|'branch2',lat:number,lng:number)=>void;
  onBranchLocationSelected?:(branch:string,lat:number,lng:number)=>void; height?:string;
}
const escape=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export default function AttendanceMap(props: Props) {
  const container=useRef<HTMLDivElement>(null);
  const map=useRef<Map|null>(null);
  const layers=useRef<LayerGroup|null>(null);
  const latest=useRef(props);
  useEffect(()=>{latest.current=props;});
  useEffect(()=>{
    let cancelled=false;
    const render=async()=>{
      const L=(await import('leaflet')).default;
      if(cancelled||!container.current)return;
      const branches=props.branches||[{id:'branch1',...props.branch1},{id:'branch2',...props.branch2}];
      if(!map.current){
        map.current=L.map(container.current,{center:[props.branch1.lat,props.branch1.lng],zoom:17});
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'© OpenStreetMap contributors'}).addTo(map.current);
        map.current.on('click',e=>{
          const p=latest.current;
          if(!p.isEditing||!p.activeEditingBranch)return;
          p.onBranchLocationSelected?.(p.activeEditingBranch,e.latlng.lat,e.latlng.lng);
          if(p.activeEditingBranch==='branch1'||p.activeEditingBranch==='branch2')p.onLocationSelected?.(p.activeEditingBranch,e.latlng.lat,e.latlng.lng);
        });
      }
      layers.current?.remove();
      layers.current=L.layerGroup().addTo(map.current);
      branches.forEach((b,i)=>{
        const color=['#059669','#4f46e5','#0284c7','#c026d3'][i%4];
        L.circle([b.lat,b.lng],{radius:b.radius,color,fillOpacity:.15}).bindPopup(`${escape(b.name)} · ${b.radius} متر`).addTo(layers.current!);
        L.circleMarker([b.lat,b.lng],{radius:7,color,fillOpacity:1}).bindTooltip(escape(b.name),{permanent:true,direction:'top'}).addTo(layers.current!);
      });
      (props.employees||[]).forEach(e=>{
        if(!Number.isFinite(e.lat)||!Number.isFinite(e.lng))return;
        const branch=branches.find(b=>b.id===e.branch_id);
        const color=e.isOnline?branch?'#059669':'#d97706':'#64748b';
        L.circleMarker([e.lat,e.lng],{radius:9,color:'#fff',weight:3,fillColor:color,fillOpacity:1}).bindPopup(`${escape(e.name)}<br/>${e.isOnline?escape(branch?.name||'خارج الفروع'):'غير متصل'}`).addTo(layers.current!);
      });
    };
    void render();
    return ()=>{cancelled=true;};
  },[props.branch1,props.branch2,props.branches,props.employees]);
  useEffect(()=>()=>{map.current?.remove();map.current=null;},[]);
  return <div style={{position:'relative',borderRadius:14,overflow:'hidden'}}><div ref={container} style={{height:props.height||'420px',width:'100%',zIndex:1}}/>{props.isEditing&&<p style={{position:'absolute',top:12,right:12,zIndex:1000,background:'white',padding:12,borderRadius:8}}>اضغط على الخريطة لتحديد موقع الفرع المختار</p>}</div>;
}
