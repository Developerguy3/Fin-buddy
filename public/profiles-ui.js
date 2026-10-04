function renderProfiles(){
  $('#profilesList').innerHTML=state.profiles.map(p=>'<button type="button" class="secondary" data-switch-profile="'+esc(p.id)+'" '+(p.id===state.activeProfile?'disabled':'')+'><span>'+esc(p.name)+'</span><span>'+(p.id===state.activeProfile?'Active':'Switch')+'</span></button>').join('');
  document.querySelectorAll('[data-switch-profile]').forEach(b=>b.onclick=()=>changeProfile({action:'switch',id:b.dataset.switchProfile}));
}
async function changeProfile(input){
  if(busy)return;
  if(openEditors.size){$('#profilesError').textContent='Save or close your open transaction editors before switching profiles.';return;}
  busy=true;$('#profilesError').textContent='';document.querySelectorAll('#profilesDialog button').forEach(b=>b.disabled=true);
  try{
    state=await api('/api/profiles',input);report=null;openEditors.clear();editorDrafts.clear();expandedBanks.clear();selectedAccount='';reviewOnly=false;transactionFilters={query:'',category:'',direction:''};filtersOpen=false;month=state.months[0]||new Date().toISOString().slice(0,7);view=input.action==='create'?'settings':'overview';render();$('#profilesDialog').close();$('#createProfile').reset();toast('Profile switched · '+state.profiles.find(p=>p.id===state.activeProfile).name);
  }catch(e){$('#profilesError').textContent=e.message;}finally{busy=false;renderProfiles();$('#profilesClose').disabled=false;$('#createProfile button').disabled=false;}
}
function initProfiles(){
  $('#manageProfiles').onclick=()=>{$('#profileMenu').hidden=true;$('#profileButton').setAttribute('aria-expanded','false');$('#profilesError').textContent='';renderProfiles();$('#profilesDialog').showModal();};
  $('#profilesClose').onclick=()=>$('#profilesDialog').close();
  $('#createProfile').onsubmit=e=>{e.preventDefault();const d=new FormData(e.target);changeProfile({action:'create',name:d.get('name'),mode:d.get('mode')});};
}
