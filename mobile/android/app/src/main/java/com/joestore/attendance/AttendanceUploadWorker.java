package com.joestore.attendance;
import android.content.Context;
import androidx.annotation.NonNull;
import androidx.work.Worker;
import androidx.work.WorkerParameters;
import java.util.concurrent.TimeUnit;

// Uploads remain scheduled even when a shift ended while the device was offline.
public class AttendanceUploadWorker extends Worker {
    public AttendanceUploadWorker(@NonNull Context context,@NonNull WorkerParameters parameters){super(context,parameters);}
    @NonNull @Override public Result doWork(){
        TrackingStore store=TrackingStore.get(getApplicationContext());
        try{
            if(store.pending()==0)return Result.success();
            store.sync();
            TrackingStore.NETWORK.submit(()->{}).get(8,TimeUnit.MINUTES);
            return store.pending()==0?Result.success():Result.retry();
        }catch(Exception error){return Result.retry();}
    }
}
