'use client';

import React, { useEffect, useRef } from 'react';

interface EmployeeMarker {
  id: number;
  name: string;
  lat: number;
  lng: number;
  branch_id: string;
  isOnline: boolean;
  distance1: number;
  distance2: number;
}

interface MapProps {
  branch1: {
    name: string;
    lat: number;
    lng: number;
    radius: number;
  };
  branch2: {
    name: string;
    lat: number;
    lng: number;
    radius: number;
  };
  employees?: EmployeeMarker[];
  isEditing?: boolean;
  activeEditingBranch?: 'branch1' | 'branch2' | null;
  onLocationSelected?: (branch: 'branch1' | 'branch2', lat: number, lng: number) => void;
  height?: string;
}

export default function AttendanceMap({
  branch1,
  branch2,
  employees = [],
  isEditing = false,
  activeEditingBranch = null,
  onLocationSelected,
  height = '420px',
}: MapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const layersRef = useRef<{
    circle1?: unknown;
    circle2?: unknown;
    marker1?: unknown;
    marker2?: unknown;
    employeeMarkers: unknown[];
  }>({ employeeMarkers: [] });

  useEffect(() => {
    if (typeof window === 'undefined' || !mapContainerRef.current) return;

    let isMounted = true;

    async function initMap() {
      const L = (await import('leaflet')).default;

      // Fix standard leaflet icon path issues in bundlers
      delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      });

      if (!mapInstanceRef.current && mapContainerRef.current) {
        // Center between branch 1 and branch 2
        const centerLat = (branch1.lat + branch2.lat) / 2 || 30.0444;
        const centerLng = (branch1.lng + branch2.lng) / 2 || 31.2357;

        const map = L.map(mapContainerRef.current, {
          center: [centerLat, centerLng],
          zoom: 17,
          attributionControl: false,
        });

        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19,
        }).addTo(map);

        map.on('click', (e: { latlng: { lat: number; lng: number } }) => {
          if (isEditing && activeEditingBranch && onLocationSelected) {
            onLocationSelected(activeEditingBranch, e.latlng.lat, e.latlng.lng);
          }
        });

        mapInstanceRef.current = map;
      }

      const map = mapInstanceRef.current as any;
      if (!map || !isMounted) return;

      // Clear previous layers
      if (layersRef.current.circle1) map.removeLayer(layersRef.current.circle1);
      if (layersRef.current.circle2) map.removeLayer(layersRef.current.circle2);
      if (layersRef.current.marker1) map.removeLayer(layersRef.current.marker1);
      if (layersRef.current.marker2) map.removeLayer(layersRef.current.marker2);
      layersRef.current.employeeMarkers.forEach((m: any) => map.removeLayer(m));
      layersRef.current.employeeMarkers = [];

      // Branch 1 Circle & Marker (Emerald Green)
      const circle1 = L.circle([branch1.lat, branch1.lng], {
        color: '#059669',
        fillColor: '#10b981',
        fillOpacity: 0.2,
        radius: branch1.radius,
        weight: 2,
      }).addTo(map);
      circle1.bindPopup(`<b>${branch1.name}</b><br/>نصف القطر: ${branch1.radius} متر`);

      const marker1 = L.circleMarker([branch1.lat, branch1.lng], {
        radius: 8,
        fillColor: '#059669',
        color: '#ffffff',
        weight: 3,
        fillOpacity: 1,
      }).addTo(map);
      marker1.bindTooltip(branch1.name, { permanent: true, direction: 'top', className: 'map-label' });

      // Branch 2 Circle & Marker (Indigo Blue)
      const circle2 = L.circle([branch2.lat, branch2.lng], {
        color: '#4f46e5',
        fillColor: '#6366f1',
        fillOpacity: 0.2,
        radius: branch2.radius,
        weight: 2,
      }).addTo(map);
      circle2.bindPopup(`<b>${branch2.name}</b><br/>نصف القطر: ${branch2.radius} متر`);

      const marker2 = L.circleMarker([branch2.lat, branch2.lng], {
        radius: 8,
        fillColor: '#4f46e5',
        color: '#ffffff',
        weight: 3,
        fillOpacity: 1,
      }).addTo(map);
      marker2.bindTooltip(branch2.name, { permanent: true, direction: 'top', className: 'map-label' });

      layersRef.current.circle1 = circle1;
      layersRef.current.circle2 = circle2;
      layersRef.current.marker1 = marker1;
      layersRef.current.marker2 = marker2;

      // Add Employee Markers
      employees.forEach((emp) => {
        if (!emp.lat || !emp.lng) return;

        let markerColor = '#64748b'; // offline
        let statusText = 'غير متصل';

        if (emp.isOnline) {
          if (emp.branch_id === 'branch1') {
            markerColor = '#059669';
            statusText = `داخل ${branch1.name}`;
          } else if (emp.branch_id === 'branch2') {
            markerColor = '#4f46e5';
            statusText = `داخل ${branch2.name}`;
          } else {
            markerColor = '#d97706';
            statusText = 'خارج المحلين';
          }
        }

        const empMarker = L.circleMarker([emp.lat, emp.lng], {
          radius: 9,
          fillColor: markerColor,
          color: '#ffffff',
          weight: 3,
          fillOpacity: 1,
        }).addTo(map);

        empMarker.bindPopup(`
          <div style="font-family: 'Cairo', sans-serif; text-align: right; direction: rtl; padding: 4px;">
            <b style="font-size: 14px;">${emp.name}</b><br/>
            <span style="color: ${markerColor}; font-weight: bold;">● ${statusText}</span><br/>
            <small style="color: #64748b;">المسافة للمحل 1: ${emp.distance1 ?? '--'} م | للمحل 2: ${emp.distance2 ?? '--'} م</small>
          </div>
        `);

        empMarker.bindTooltip(emp.name, { permanent: false, direction: 'bottom' });
        layersRef.current.employeeMarkers.push(empMarker);
      });
    }

    initMap();

    return () => {
      isMounted = false;
    };
  }, [branch1, branch2, employees, isEditing, activeEditingBranch]);

  return (
    <div style={{ position: 'relative', width: '100%', borderRadius: '14px', overflow: 'hidden' }}>
      <div ref={mapContainerRef} style={{ height, width: '100%', zIndex: 1 }} />
      {isEditing && (
        <div
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 1000,
            background: 'rgba(255, 255, 255, 0.95)',
            backdropFilter: 'blur(4px)',
            padding: '8px 14px',
            borderRadius: '8px',
            border: '1px solid #e2e8f0',
            fontSize: '13px',
            fontWeight: 600,
            color: '#1e293b',
            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)',
          }}
        >
          {activeEditingBranch === 'branch1'
            ? '📌 انقر على الخريطة لتحديد موقع: المحل الأول'
            : activeEditingBranch === 'branch2'
            ? '📌 انقر على الخريطة لتحديد موقع: المحل الثاني'
            : 'اختر المحل لتحديد موقعه بالخريطة'}
        </div>
      )}
    </div>
  );
}
