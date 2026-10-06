package com.joestore.attendance;
import androidx.activity.ComponentActivity;
import androidx.activity.OnBackPressedCallback;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.webkit.*;
import android.widget.*;
import javax.net.ssl.HttpsURLConnection;
import java.net.URL;
import java.io.*;
/** Administrator screens; remote content has no JavaScript-to-native bridge. */
public class AdminActivity extends ComponentActivity {
    private WebView web;
    private byte[] exportData;
    private final ActivityResultLauncher<String> saveCsv=registerForActivityResult(new ActivityResultContracts.CreateDocument("text/csv"),target->saveExport(target));
    @Override public void onCreate(Bundle state){
        super.onCreate(state);
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);
        layout.setOnApplyWindowInsetsListener((view,insets)->{view.setPadding(insets.getSystemWindowInsetLeft(),insets.getSystemWindowInsetTop(),insets.getSystemWindowInsetRight(),insets.getSystemWindowInsetBottom());return insets;});
        Button back=new Button(this);back.setText("الرجوع للتطبيق");back.setOnClickListener(v->finish());layout.addView(back);
        web=new WebView(this);layout.addView(web,new LinearLayout.LayoutParams(-1,0,1));setContentView(layout);
        WebSettings settings=web.getSettings();settings.setJavaScriptEnabled(true);settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);settings.setAllowContentAccess(false);settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);settings.setSafeBrowsingEnabled(true);
        CookieManager.getInstance().setAcceptThirdPartyCookies(web,false);
        web.setDownloadListener((url,agent,disposition,mime,length)->saveReport(url));
        web.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view,WebResourceRequest request){
                if(!request.isForMainFrame())return false;Uri uri=request.getUrl();
                if("https".equals(uri.getScheme())&&"attendance-system-joe-2026.vercel.app".equalsIgnoreCase(uri.getHost()))return false;
                if("https".equals(uri.getScheme())){try{startActivity(new Intent(Intent.ACTION_VIEW,uri));}catch(Exception ignored){}}return true;
            }
        });
        web.loadUrl(TrackingStore.API);
        getOnBackPressedDispatcher().addCallback(this,new OnBackPressedCallback(true){@Override public void handleOnBackPressed(){if(web.canGoBack())web.goBack();else finish();}});
    }
    private void saveReport(String url){
        Uri uri=Uri.parse(url);
        if(!"https".equals(uri.getScheme())||!"attendance-system-joe-2026.vercel.app".equalsIgnoreCase(uri.getHost())||!"/api/attendance/export".equals(uri.getPath()))return;
        new Thread(()->{
            try{
                TrackingStore store=TrackingStore.get(this);int owner=store.userId();
                HttpsURLConnection connection=(HttpsURLConnection)new URL(url).openConnection();
                try{
                    connection.setInstanceFollowRedirects(false);connection.setConnectTimeout(15000);connection.setReadTimeout(30000);connection.setRequestProperty("Authorization","Bearer "+store.token());
                    if(connection.getResponseCode()!=200||!connection.getContentType().startsWith("text/csv"))throw new IOException();
                    ByteArrayOutputStream bytes=new ByteArrayOutputStream();
                    try(InputStream input=connection.getInputStream()){byte[] buffer=new byte[4096];int n;while((n=input.read(buffer))!=-1){if(bytes.size()+n>5*1024*1024)throw new IOException();bytes.write(buffer,0,n);}}
                    if(owner!=store.userId())return;
                    runOnUiThread(()->{if(isFinishing())return;exportData=bytes.toByteArray();saveCsv.launch("attendance-report.csv");});
                }finally{connection.disconnect();}
            }catch(Exception error){runOnUiThread(()->Toast.makeText(this,"تعذر تنزيل التقرير؛ راجع الاتصال والجلسة",Toast.LENGTH_LONG).show());}
        }).start();
    }
    private void saveExport(Uri target){
        byte[] bytes=exportData;exportData=null;
        if(target==null||bytes==null)return;
        new Thread(()->{try(OutputStream out=getContentResolver().openOutputStream(target)){if(out==null)throw new IOException();out.write(bytes);runOnUiThread(()->Toast.makeText(this,"تم حفظ التقرير",Toast.LENGTH_LONG).show());}catch(Exception error){runOnUiThread(()->Toast.makeText(this,"تعذر حفظ الملف",Toast.LENGTH_LONG).show());}}).start();
    }
    @Override public void onDestroy(){if(web!=null)web.destroy();super.onDestroy();}
}
