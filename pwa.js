'use strict';
function nativeApp(){
  try{
    if(window.Capacitor?.isNativePlatform?.())return true;
    const protocol=location.protocol;
    return protocol==='capacitor:'||protocol==='ionic:';
  }catch{return false;}
}
// A service worker in a packed WebView only gets in the way if the files are already on disk.
if('serviceWorker' in navigator&&window.isSecureContext&&!nativeApp()){
  window.addEventListener('load',()=>{navigator.serviceWorker.register('./sw.js').catch(()=>{/* Offline first visit or disabled workers: the notebook still works. */});});
}
// Android's back control should close an open dialog before it leaves the page.
(function(){
  if(typeof HTMLDialogElement==='undefined')return;
  let fromBack=false;
  const openModal=HTMLDialogElement.prototype.showModal;
  HTMLDialogElement.prototype.showModal=function(){
    if(!this.open){
      try{history.pushState({hlDialog:1},'');}catch{}
      this.dataset.hlPushed='1';
    }
    return openModal.apply(this,arguments);
  };
  window.addEventListener('popstate',()=>{
    const dialog=document.querySelector('dialog[open]');
    if(!dialog)return;
    fromBack=true;
    dialog.close();
    fromBack=false;
  });
  document.addEventListener('close',event=>{
    const dialog=event.target;
    if(!(dialog instanceof HTMLDialogElement)||dialog.dataset.hlPushed!=='1')return;
    dialog.dataset.hlPushed='';
    if(fromBack)return;
    if(history.state&&history.state.hlDialog){try{history.back();}catch{}}
  },true);
})();
