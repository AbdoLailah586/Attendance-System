// Geolocation & attendance calculations

export interface Branch { id: string; name: string; lat: number; lng: number; radius: number; is_active?: boolean }
export interface StoreSettings {
  attendance_mode?: string;
  nfc_enabled_at?: string;
  attendance_reset_at?: string | null;
  branches?: Branch[];
  id: string;
  branch1_name: string;
  branch1_lat: number;
  branch1_lng: number;
  branch1_radius: number;
  branch2_name: string;
  branch2_lat: number;
  branch2_lng: number;
  branch2_radius: number;
  shift_start_time: string; // e.g. "10:00"
  shift_end_time: string;   // e.g. "22:00"
  grace_period_mins: number; // e.g. 30 mins (until 10:30 is normal)
  ping_interval_secs: number; // e.g. 60 secs
}

// Calculate distance in meters using Haversine formula
export function calculateDistance(
  lat1: number,
  lon1: number,
  lat2: number,
  lon2: number
): number {
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return Math.round(R * c);
}

// Determine which branch the user is located in
export function determineBranchLocation(
  userLat: number,
  userLng: number,
  settings: StoreSettings
): {
  branch_id: string;
  branch_name: string;
  distance1: number;
  distance2: number;
  inside1: boolean;
  inside2: boolean;
} {
  const dist1 = calculateDistance(userLat, userLng, settings.branch1_lat, settings.branch1_lng);
  const dist2 = calculateDistance(userLat, userLng, settings.branch2_lat, settings.branch2_lng);

  const inside1 = dist1 <= settings.branch1_radius;
  const inside2 = dist2 <= settings.branch2_radius;

  if (settings.branches) {
    const nearest = settings.branches.filter(b => b.is_active !== false)
      .map(b => ({ ...b, distance: calculateDistance(userLat, userLng, b.lat, b.lng) }))
      .filter(b => b.distance <= b.radius).sort((a,b) => a.distance - b.distance)[0];
    return { branch_id: nearest?.id || 'outside', branch_name: nearest?.name || 'خارج الفروع', distance1: dist1, distance2: dist2, inside1, inside2 };
  }

  if (inside1 && inside2) {
    // If inside both overlapping geofences, choose the closest one
    if (dist1 <= dist2) {
      return {
        branch_id: 'branch1',
        branch_name: settings.branch1_name,
        distance1: dist1,
        distance2: dist2,
        inside1: true,
        inside2: true,
      };
    } else {
      return {
        branch_id: 'branch2',
        branch_name: settings.branch2_name,
        distance1: dist1,
        distance2: dist2,
        inside1: true,
        inside2: true,
      };
    }
  }

  if (inside1) {
    return {
      branch_id: 'branch1',
      branch_name: settings.branch1_name,
      distance1: dist1,
      distance2: dist2,
      inside1: true,
      inside2: false,
    };
  }

  if (inside2) {
    return {
      branch_id: 'branch2',
      branch_name: settings.branch2_name,
      distance1: dist1,
      distance2: dist2,
      inside1: false,
      inside2: true,
    };
  }

  return {
    branch_id: 'outside',
    branch_name: 'خارج المحلين',
    distance1: dist1,
    distance2: dist2,
    inside1: false,
    inside2: false,
  };
}

// Convert minutes to readable Arabic text (e.g. 7 ساعات و 45 دقيقة)
export function verifiedBranchLocation(lat: number, lng: number, accuracy: number, settings: StoreSettings) {
  const result = determineBranchLocation(lat, lng, settings);
  const branches = settings.branches || [
    {id:'branch1',name:settings.branch1_name,lat:settings.branch1_lat,lng:settings.branch1_lng,radius:settings.branch1_radius},
    {id:'branch2',name:settings.branch2_name,lat:settings.branch2_lat,lng:settings.branch2_lng,radius:settings.branch2_radius},
  ];
  const distances = branches.map(branch => ({...branch,distance:calculateDistance(lat,lng,branch.lat,branch.lng)}));
  const confirmed = distances.filter(b=>b.distance+accuracy<=b.radius).sort((a,b)=>a.distance-b.distance)[0];
  if (confirmed) return {...result,branch_id:confirmed.id,branch_name:confirmed.name};
  if (distances.some(b=>b.distance-accuracy<=b.radius)) return {...result,branch_id:'unknown',branch_name:'موقع غير مؤكد عند حدود الفرع'};
  return {...result,branch_id:'outside',branch_name:'خارج الفروع'};
}

export function formatDurationArabic(minutes: number): string {
  const totalMins = Math.max(0, Math.round(minutes));
  const hours = Math.floor(totalMins / 60);
  const remainingMins = totalMins % 60;

  if (hours === 0 && remainingMins === 0) return '0 دقيقة';
  if (hours === 0) return `${remainingMins} دقيقة`;
  if (remainingMins === 0) {
    if (hours === 1) return 'ساعة واحدة';
    if (hours === 2) return 'ساعتان';
    if (hours >= 3 && hours <= 10) return `${hours} ساعات`;
    return `${hours} ساعة`;
  }

  let hoursText = `${hours} ساعة`;
  if (hours === 1) hoursText = 'ساعة';
  if (hours === 2) hoursText = 'ساعتان';
  if (hours >= 3 && hours <= 10) hoursText = `${hours} ساعات`;

  return `${hoursText} و ${remainingMins} دقيقة`;
}

// Evaluate punctuality based on first arrival timestamp and shift start time
export function evaluatePunctuality(
  firstArrivalTime: Date | string | null,
  shiftStartTimeStr: string = '10:00',
  gracePeriodMins: number = 30,
  scheduledStart?: Date,
): {
  status: 'early' | 'on_time' | 'late' | 'absent';
  label: string;
  badgeClass: string;
  diffMinutes: number;
  message: string;
} {
  if (!firstArrivalTime) {
    return {
      status: 'absent',
      label: 'لم يحضر',
      badgeClass: 'badge-absent',
      diffMinutes: 0,
      message: 'لم يتم تسجيل أي حضور اليوم',
    };
  }

  const arrival = new Date(firstArrivalTime);
  const [shiftHour, shiftMin] = shiftStartTimeStr.split(':').map(Number);

  // Shift start datetime on the same day as arrival
  const shiftStart = scheduledStart || new Date(arrival);
  if (!scheduledStart) shiftStart.setHours(shiftHour, shiftMin, 0, 0);

  // Difference in minutes: arrival - shiftStart
  const diffMins = Math.round((arrival.getTime() - shiftStart.getTime()) / (1000 * 60));

  if (diffMins < 0) {
    const earlyBy = Math.abs(diffMins);
    return {
      status: 'early',
      label: 'حضور مبكر',
      badgeClass: 'badge-early',
      diffMinutes: diffMins,
      message: `حضر مبكراً بـ ${formatDurationArabic(earlyBy)} قبل الميعاد`,
    };
  }

  if (diffMins <= gracePeriodMins) {
    return {
      status: 'on_time',
      label: 'في الميعاد',
      badgeClass: 'badge-ontime',
      diffMinutes: diffMins,
      message: diffMins === 0 ? 'حضر في تمام الموعد' : `حضر خلال فترة السماح (+${diffMins} د)`,
    };
  }

  const lateBy = diffMins;
  return {
    status: 'late',
    label: 'حضور متأخر',
    badgeClass: 'badge-late',
    diffMinutes: lateBy,
    message: `متأخر عن الميعاد بـ ${formatDurationArabic(lateBy)}`,
  };
}
