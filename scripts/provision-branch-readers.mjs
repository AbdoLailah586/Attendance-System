import {readFile,writeFile,mkdir,access} from 'node:fs/promises';
import {join} from 'node:path';
const origin='https://attendance-system-joe-2026.vercel.app';
if(!process.env.LOCALAPPDATA||!process.env.QA_ADMIN_USERNAME||!process.env.QA_ADMIN_PASSWORD)throw new Error('LocalAppData and administrator credentials required');
const folder=join(process.env.LOCALAPPDATA,'JoeStore','Attendance','ReaderConfigs');await mkdir(folder,{recursive:true});
const template=await readFile('firmware/esp32-reader/include/config.example.h','utf8');
const login=await fetch(origin+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:process.env.QA_ADMIN_USERNAME,password:process.env.QA_ADMIN_PASSWORD})});
if(!login.ok)throw new Error('Administrator login failed');const {token}=await login.json();
const headers={Authorization:'Bearer '+token,'Content-Type':'application/json'};
const inventory=await fetch(origin+'/api/nfc/admin',{headers});if(!inventory.ok)throw new Error('Could not load readers');const devices=(await inventory.json()).devices;
for(const [branch_id,name] of [['branch1','قارئ الفرع الأساسي'],['branch2','قارئ فرع الجملة']]){
 const path=join(folder,branch_id+'.h');
 try{await access(path);console.log('Existing private configuration retained: '+path);continue;}catch{}
 if(devices.some(d=>d.branch_id===branch_id&&d.name===name))throw new Error('Reader already exists without local config; recover or rotate its key in the administrator panel: '+name);
 const response=await fetch(origin+'/api/nfc/admin',{method:'POST',headers,body:JSON.stringify({action:'create_device',branch_id,name})});
 if(!response.ok)throw new Error('Could not create '+name);const result=await response.json();
 await writeFile(path,template.replace('REPLACE_FROM_ADMIN',result.device_id).replace('REPLACE_FROM_ADMIN',result.token),{flag:'wx',mode:0o600});
 console.log('Reader created; private configuration saved: '+path);
}
console.log('Fill Wi-Fi locally. Credentials were not printed or committed.');
