import {NextRequest,NextResponse} from 'next/server';
import {getActiveSession} from '@/lib/auth';
import {loadSettings} from '@/lib/schema';
import {businessDay} from '@/lib/card-day';
import {addDays} from '@/lib/period-report';
import {validDay} from '@/lib/time';
import {loadDayCloseReport} from '@/lib/day-close-report';
export async function GET(req:NextRequest){
  if((await getActiveSession(req))?.role!=='admin')return NextResponse.json({error:'صلاحيات المدير مطلوبة'},{status:403});
  try{
    const settings=await loadSettings(),now=new Date();
    const selected=req.nextUrl.searchParams.get('date');
    const day=selected==='current'?businessDay(now,settings.business_day_start_time):selected||addDays(businessDay(now,settings.business_day_start_time),-1);
    if(!validDay(day)||day>businessDay(now,settings.business_day_start_time))return NextResponse.json({error:'يوم عمل غير صالح'},{status:400});
    return NextResponse.json(await loadDayCloseReport(day,now),{headers:{'Cache-Control':'private, no-store'}});
  }catch(e){console.error('Day close report',e);return NextResponse.json({error:'تعذر تحميل ملخص يوم العمل'},{status:503});}
}
