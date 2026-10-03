import {X509Certificate} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import https from 'node:https';
const response=await fetch('https://pki.goog/roots.pem');
if(!response.ok)throw new Error('Could not retrieve Google Trust Services roots');
const certificates=(await response.text()).match(/-----BEGIN CERTIFICATE-----[\s\S]*?-----END CERTIFICATE-----/g)||[];
const roots=certificates.filter(pem=>{const cert=new X509Certificate(pem);return cert.ca&&/CN=GTS Root R[1-4](?:\n|$)/.test(cert.subject);});
if(roots.length!==4)throw new Error('Expected four Google Trust Services roots; inspect root changes before replacing');
const pem=roots.join('\n')+'\n';
// Validate the actual deployed HTTPS host using exactly the embedded trust anchors.
await new Promise((resolve,reject)=>{const request=https.get('https://attendance-system-joe-2026.vercel.app/api/health',{ca:pem},res=>{res.resume();if(res.statusCode!==200)reject(new Error('Production health did not return 200'));else resolve();});request.setTimeout(15000,()=>request.destroy(new Error('TLS verification timed out')));request.on('error',reject);});
await writeFile('firmware/esp32-reader/include/certs.h','#pragma once\n// Public Google Trust Services roots. Regenerate with scripts/update-reader-roots.mjs.\nstatic const char TRUSTED_ROOTS[] = R"CERT(\n'+pem+')CERT";\n');
console.log('Four public GTS roots saved; production HTTPS verified with the same trust anchors');
