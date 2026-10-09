let installPrompt;
window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();installPrompt=e;});
window.addEventListener('appinstalled',()=>{installPrompt=null;});
function initPlatform(){
 const native=window.Capacitor?.isNativePlatform?.();
 const banner=document.querySelector('#connectionBanner');
 const update=()=>{banner.hidden=!!window.FinBuddyDevice||!!native||navigator.onLine;};update();window.addEventListener('online',update);window.addEventListener('offline',update);
 document.querySelector('#installApp').onclick=async()=>{
  document.querySelector('#profileMenu').hidden=true;
  if(installPrompt){await installPrompt.prompt();await installPrompt.userChoice;installPrompt=null;return;}
  document.querySelector('#helpTitle').textContent='Install Fin Buddy';
  document.querySelector('#helpBody').innerHTML='<div class="install-guide"><p><b>Android:</b> Open this workspace in Chrome, then choose Install app or Add to Home screen from its menu.</p><p><b>iPhone / iPad:</b> Open it in Safari, tap Share, then Add to Home Screen and Open as Web App when offered.</p><p><b>Desktop:</b> Use the install option in Chrome or Edge.</p><p>Your workspace server must be reachable. A computer’s localhost address does not work from a phone. Mobile installation requires a secure HTTPS workspace address.</p></div>';
  document.querySelector('#helpDialog').showModal();
 };
 if(native)document.querySelector('#installApp').hidden=true;
 if(!native&&'serviceWorker' in navigator&&window.isSecureContext)navigator.serviceWorker.register(window.FinBuddyDevice?'/device-sw.js':'/sw.js').catch(()=>{});
}
