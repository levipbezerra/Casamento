/* Casamento Victória & Levi — módulo privado / QR check-in.
   Jamais guardar a lista no repositório público ou em localStorage.
   Toda autorização é feita no servidor por RLS e RPC. */
(function(){
'use strict';
const PAGE=document.body.dataset.page;
const $=id=>document.getElementById(id);
const cfg=window.WEDDING_SUPABASE||{};
const ready=Boolean(cfg.url&&cfg.publishableKey&&window.supabase);
const api=ready?window.supabase.createClient(cfg.url,cfg.publishableKey,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}}):null;
let currentUser=null, role=null, guests=[], staff=[], activeQr=null, scanner=null, scannedToken='', scannerLocked=false;
const defaultTypes=['Convidado','Grau 1','Grau 2','Grau 3','Madrinha','Padrinho','Banda','Cerimonialista'];
const dateFmt=d=>d?new Date(d).toLocaleString('pt-BR',{timeZone:'America/Fortaleza',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'';
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function toast(msg,error=false){
  const t=$('toast');if(!t){return}t.textContent=msg;t.style.background=error?'#9f3541':'#101d32';t.hidden=false;
  clearTimeout(t._timer);t._timer=setTimeout(()=>t.hidden=true,5200);
}
function failed(error,fallback='Não foi possível concluir a operação.'){
  console.error(error);
  toast(error?.message||fallback,true);
}
function setViewAuth(isLogged){
  $('auth-shell').hidden=isLogged;$('app-shell').hidden=!isLogged;$('logout-btn').hidden=!isLogged;
  if(!isLogged&&$('account-label'))$('account-label').textContent=PAGE==='admin'?'Gestão dos convidados':'Check-in de convidados';
}
function missingSetup(){
  $('auth-message').textContent='A base de dados ainda não foi configurada. O administrador deve executar database/wedding-setup.sql e revisar wedding-config.js.';
  $('auth-message').style.color='#a53f49';
  $('auth-form').querySelector('button').disabled=true;
}
async function init(){
  setViewAuth(false);
  $('auth-form').addEventListener('submit',requestMagicLink);
  $('logout-btn').addEventListener('click',async()=>{
    if(scanner)await stopCamera();
    await api?.auth.signOut();currentUser=null;role=null;setViewAuth(false);
  });
  if(!ready){missingSetup();return}
  const {data,error}=await api.auth.getSession();
  if(error){failed(error);return}
  if(data.session)await restore(data.session.user);
  api.auth.onAuthStateChange((event,session)=>{
    if(event==='SIGNED_OUT'){currentUser=null;role=null;setViewAuth(false);return}
    if(event==='SIGNED_IN'&&session?.user&&session.user.id!==currentUser?.id){
      setTimeout(()=>restore(session.user),0);
    }
  });
}
async function requestMagicLink(ev){
  ev.preventDefault();
  if(!api){missingSetup();return}
  const email=$('auth-email').value.trim().toLowerCase();
  const button=ev.currentTarget.querySelector('button');
  button.disabled=true;
  $('auth-message').textContent='Enviando link de acesso…';
  try{
    const redirect=window.location.origin+window.location.pathname;
    try{localStorage.setItem('levih-login-intent',JSON.stringify({page:PAGE,time:Date.now()}))}catch(_){}
    const {error}=await api.auth.signInWithOtp({email,options:{emailRedirectTo:redirect,shouldCreateUser:true}});
    if(error)throw error;
    $('auth-message').textContent='Verifique sua caixa de entrada. Abra o link neste dispositivo para acessar.';
    toast('Link enviado. Confira seu e-mail.');
  }catch(e){failed(e,'Falha ao enviar e-mail.');$('auth-message').textContent='Não foi possível enviar. Verifique as configurações de autenticação.'}
  finally{button.disabled=false}
}
async function restore(user){
  if(!user?.email)return;
  try{
    const email=user.email.trim().toLowerCase();
    const {data,error}=await api.from('wedding_staff').select('role,active,email').eq('email',email).maybeSingle();
    if(error)throw error;
    if(!data?.active||!(PAGE==='admin'?data.role==='admin':['admin','door'].includes(data.role))){
      await api.auth.signOut();
      $('auth-message').textContent=PAGE==='admin'?'Este e-mail não tem permissão de administrador.':'Solicite sua autorização à administração da lista.';
      $('auth-message').style.color='#a43c49';return;
    }
    currentUser=user;role=data.role;setViewAuth(true);
    $('account-label').textContent=email+(PAGE==='door'?' · Portaria':' · Administração');
    if(PAGE==='admin'){bindAdmin();await loadGuests();await loadStaff()}
    else {bindDoor();await loadDoorStats()}
  }catch(e){setViewAuth(false);$('auth-message').textContent='Base de dados indisponível ou não preparada. Verifique a conexão com o Supabase.';failed(e)}
}
function uniqueTypes(){return [...new Set(defaultTypes.concat(guests.map(g=>g.guest_type).filter(Boolean)))].sort((a,b)=>a.localeCompare(b,'pt-BR'))}
function setOptions(select,types,includeAll=false){
  const selected=select.value;select.replaceChildren();
  if(includeAll){const opt=new Option('Todos os tipos','');select.add(opt)}
  types.forEach(x=>select.add(new Option(x,x)));
  select.value=types.includes(selected)?selected:(includeAll?'':'Convidado');
}
let adminBound=false;
function bindAdmin(){
  if(adminBound)return;adminBound=true;
  $('add-guest').addEventListener('click',()=>openEditor());
  $('import-top').addEventListener('click',()=>switchTab('files'));
  $('reload-guests').addEventListener('click',loadGuests);
  $('search-guests').addEventListener('input',renderGuests);
  $('type-filter').addEventListener('change',renderGuests);
  $('checkin-filter').addEventListener('change',renderGuests);
  document.querySelectorAll('[data-view]').forEach(el=>el.addEventListener('click',()=>switchTab(el.dataset.view)));
  document.querySelectorAll('[data-close]').forEach(el=>el.addEventListener('click',()=>$(el.dataset.close).hidden=true));
  document.querySelectorAll('.dialog-shade').forEach(el=>el.addEventListener('click',e=>{if(e.target===el)el.hidden=true}));
  $('guest-form').addEventListener('submit',saveGuest);
  $('guests-body').addEventListener('click',handleGuestAction);
  $('staff-form').addEventListener('submit',saveStaff);
  $('staff-list').addEventListener('click',handleStaffAction);
  $('start-import').addEventListener('click',importSheet);
  $('export-list').addEventListener('click',exportCsv);
   $('export-qrs').addEventListener('click',downloadAllQrs);
  $('print-qr').addEventListener('click',()=>window.print());
  $('download-qr').addEventListener('click',downloadQrCard);
  setInterval(()=>{if(currentUser&&PAGE==='admin'&&!document.hidden)loadGuests(true)},30000);
}
function switchTab(name){
  ['guests','team','files'].forEach(v=>{
    $(v+'-view').hidden=v!==name;
    document.querySelector('[data-view="'+v+'"]').classList.toggle('active',v===name);
  });
}
async function loadGuests(silent=false){
  try{
    const out=[];for(let start=0;;start+=1000){
      const {data,error}=await api.from('wedding_guests').select('*').order('name',{ascending:true}).range(start,start+999);
      if(error)throw error;
      out.push(...data);if(data.length<1000)break;
    }
    guests=out.sort((a,b)=>a.name.localeCompare(b.name,'pt-BR'));
    setOptions($('type-filter'),uniqueTypes(),true);
    setOptions($('guest-type'),uniqueTypes(),false);
    renderGuests();
  }catch(e){if(!silent)failed(e)}
}
function renderGuests(){
  const total=guests.length,entered=guests.filter(g=>g.checked_in_at).length;
  $('stat-total').textContent=total;$('stat-arrived').textContent=entered;$('stat-pending').textContent=total-entered;
  $('stat-rsvp').textContent=guests.filter(g=>String(g.rsvp_status).toUpperCase().includes('CONFIRMADO')&&!String(g.rsvp_status).toUpperCase().includes('NÃO')).length;
  const query=$('search-guests').value.trim().toLocaleLowerCase('pt-BR'),type=$('type-filter').value,check=$('checkin-filter').value;
  const found=guests.filter(g=>(!type||g.guest_type===type)&&(!query||g.name.toLocaleLowerCase('pt-BR').includes(query)||String(g.legacy_number||'').includes(query))&&(!check||(check==='entered'?!!g.checked_in_at:!g.checked_in_at)));
  $('shown-count').textContent=found.length+' exibidos';
  const html=found.map(g=>{
    const id=esc(g.id),checked=!!g.checked_in_at;
    const actions='<div class="table-actions"><button class="btn sm gold" data-action="qr" data-id="'+id+'">QR</button><button class="btn sm outline" data-action="edit" data-id="'+id+'">Editar</button>'+
      '<button class="btn sm '+(checked?'danger':'outline')+'" data-action="check" data-id="'+id+'">'+(checked?'Desfazer entrada':'Marcar entrada')+'</button>'+
      '<button class="btn sm danger" data-action="delete" data-id="'+id+'">Excluir</button></div>';
    const yes=String(g.rsvp_status||'').toUpperCase()==='CONFIRMADO';
    return '<tr><td>'+esc(g.legacy_number??'—')+'</td><td><strong>'+esc(g.name)+'</strong></td><td><span class="badge gold">'+esc(g.guest_type)+'</span></td>'+
      '<td><span class="badge '+(yes?'yes':'')+'">'+esc(g.rsvp_status||(g.invitation_status?'Não confirmado':'Pendente'))+'</span></td>'+
      '<td><span class="badge '+(checked?'yes':'no')+'">'+(checked?'Entrou · '+esc(dateFmt(g.checked_in_at)):'Aguardando')+'</span></td><td>'+actions+'</td></tr>';
  }).join('');
  $('guests-body').innerHTML=html||'<tr><td colspan="6" class="empty">Nenhum convidado encontrado. Use “Novo convidado” ou importe sua planilha privada.</td></tr>';
}
function openEditor(guest){
  const g=guest||{};
  $('editor-title').textContent=guest?'Editar convidado':'Novo convidado';
  $('guest-id').value=g.id||'';$('guest-name').value=g.name||'';$('guest-number').value=g.legacy_number||'';
  $('guest-type').value=g.guest_type||'Convidado';$('guest-new-type').value='';$('guest-invite').value=g.invitation_status||'';
  $('guest-rsvp').value=g.rsvp_status||'';$('guest-notes').value=g.notes||'';$('guest-ok').checked=!!g.list_ok;
  if(g.invitation_status&&!Array.from($('guest-invite').options).some(o=>o.value===g.invitation_status))$('guest-invite').add(new Option(g.invitation_status,g.invitation_status));
  if(g.rsvp_status&&!Array.from($('guest-rsvp').options).some(o=>o.value===g.rsvp_status))$('guest-rsvp').add(new Option(g.rsvp_status,g.rsvp_status));
  $('editor-modal').hidden=false;$('guest-name').focus();
}
async function saveGuest(ev){
  ev.preventDefault();
  const button=$('save-guest');button.disabled=true;
  const id=$('guest-id').value,payload={
    name:$('guest-name').value.trim(),
    guest_type:$('guest-new-type').value.trim()||$('guest-type').value,
    legacy_number:$('guest-number').value?Number($('guest-number').value):null,
    invitation_status:$('guest-invite').value,
    rsvp_status:$('guest-rsvp').value,
    notes:$('guest-notes').value.trim(),
    list_ok:$('guest-ok').checked
  };
  try{
    if(!payload.name)throw Error('Informe o nome do convidado.');
    const q=id?api.from('wedding_guests').update(payload).eq('id',id):api.from('wedding_guests').insert(payload);
    const {error}=await q;if(error)throw error;
    $('editor-modal').hidden=true;toast('Convidado salvo com sucesso.');await loadGuests();
  }catch(e){failed(e)}finally{button.disabled=false}
}
async function handleGuestAction(e){
  const b=e.target.closest('[data-action]');if(!b)return;
  const g=guests.find(x=>x.id===b.dataset.id);if(!g)return;
  switch(b.dataset.action){
    case 'qr':return openQr(g);
    case 'edit':return openEditor(g);
    case 'check':{
      const undo=!!g.checked_in_at;
      if(!confirm((undo?'Desfazer a entrada de ':'Confirmar entrada de ')+g.name+'?'))return;
      const patch=undo?{checked_in_at:null,checked_in_by:null}:{checked_in_at:new Date().toISOString(),checked_in_by:currentUser.id};
      const {error}=await api.from('wedding_guests').update(patch).eq('id',g.id);
      if(error)return failed(error);toast(undo?'Entrada desfeita; QR pode ser testado novamente.':'Entrada confirmada.');return loadGuests();
    }
    case 'delete':{
      if(!confirm('Excluir DEFINITIVAMENTE '+g.name+'? O QR Code ficará inválido.'))return;
      const {error}=await api.from('wedding_guests').delete().eq('id',g.id);
      if(error)return failed(error);toast('Convidado excluído.');return loadGuests();
    }
  }
}
function openQr(g){
  if(!window.QRCode){return toast('Biblioteca de QR Code não carregada. Verifique sua conexão.',true)}
  activeQr=g;$('qr-guest-name').textContent=g.name;$('qr-guest-type').textContent=g.guest_type;
  $('qr-box').replaceChildren();
  new QRCode($('qr-box'),{text:'W26:'+g.qr_token,width:224,height:224,colorDark:'#101d32',colorLight:'#ffffff',correctLevel:QRCode.CorrectLevel.H});
  $('qr-modal').hidden=false;
}
function drawQrCard(qr,guest){
  const c=document.createElement('canvas');c.width=720;c.height=910;
  const x=c.getContext('2d');
  x.fillStyle='#fff';x.fillRect(0,0,720,910);
  x.fillStyle='#101d32';x.fillRect(0,0,720,225);
  x.fillStyle='#c7a46a';x.fillRect(40,42,640,2);
  x.textAlign='center';x.fillStyle='#c7a46a';x.font='24px Georgia';
  x.fillText('V I C T Ó R I A  &  L E V I',360,103);
  x.fillStyle='#fff';x.font='43px Georgia';x.fillText('Nossa celebração',360,168);
  x.fillStyle='#b89355';x.font='22px Georgia';x.fillText('28 · 12 · 2026',360,279);
  x.drawImage(qr,188,330,344,344);
  x.fillStyle='#101d32';
  let fontSize=34;
  do {x.font='bold '+fontSize+'px Georgia';if(x.measureText(guest.name).width<=640)break;fontSize--}while(fontSize>18);
  x.fillText(guest.name,360,740,640);
  x.font='21px Arial';x.fillStyle='#7d6546';x.fillText(guest.guest_type,360,779,640);
  x.font='16px Arial';x.fillText('Apresente este QR Code na entrada',360,845);
  return c;
}
function safeName(g){
  const name=g.name.normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-zA-Z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55);
  return String(g.legacy_number||g.id.slice(0,8)).padStart(3,'0')+'-'+name;
}
function downloadCanvas(canvas,filename){
  const a=document.createElement('a');a.download=filename;a.href=canvas.toDataURL('image/png');a.click();
}
function downloadQrCard(){
  if(!activeQr)return;
  try{
    const qr=$('qr-box').querySelector('canvas')||$('qr-box').querySelector('img');
    if(!qr)throw Error('QR Code ainda não disponível.');
    downloadCanvas(drawQrCard(qr,activeQr),'QR-'+safeName(activeQr)+'.png');
  }catch(e){failed(e)}
}
async function downloadAllQrs(){
  if(!guests.length)return toast('Não há convidados para exportar.',true);
  if(!window.JSZip||!window.QRCode)return toast('Bibliotecas de exportação indisponíveis. Verifique sua conexão.',true);
  const button=$('export-qrs'),progress=$('qr-export-progress');
  if(button.disabled)return;
  button.disabled=true;button.textContent='Preparando QR Codes…';
  progress.textContent='Gerando 0 de '+guests.length+' imagens personalizadas.';
  try{
    const zip=new JSZip();
    const ordered=[...guests].sort((a,b)=>(a.legacy_number??999999)-(b.legacy_number??999999));
    for(let i=0;i<ordered.length;i++){
      const g=ordered[i];
      const div=document.createElement('div');
      new QRCode(div,{text:'W26:'+g.qr_token,width:224,height:224,colorDark:'#101d32',colorLight:'#fff',correctLevel:QRCode.CorrectLevel.H});
      const qr=div.querySelector('canvas')||div.querySelector('img');
      if(!qr)throw Error('Falha ao gerar QR do registro '+(g.legacy_number??i+1));
      const card=drawQrCard(qr,g);
      zip.file('QR-'+safeName(g)+'.png',card.toDataURL('image/png').split(',')[1],{base64:true});
      if((i+1)%5===0||i===ordered.length-1){
        progress.textContent='Gerando '+(i+1)+' de '+ordered.length+' imagens personalizadas.';
        await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    progress.textContent='Compactando '+ordered.length+' QR Codes…';
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE',compressionOptions:{level:4}});
    const url=URL.createObjectURL(blob),a=document.createElement('a');
    a.href=url;a.download='QR-Codes-Casamento-Victoria-Levi.zip';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),15000);
    progress.textContent=ordered.length+' QR Codes gerados. Cada imagem corresponde a um registro exclusivo.';
    toast('Pacote de QR Codes gerado com sucesso.');
  }catch(e){failed(e);progress.textContent='Falha na geração. Tente novamente.'}
  finally{button.disabled=false;button.textContent='Baixar todos os QR Codes (.ZIP)'}
}
async function loadStaff(){
  const {data,error}=await api.from('wedding_staff').select('email,role,active,created_at').order('email');
  if(error)return failed(error);staff=data||[];
  $('staff-list').innerHTML=staff.map(s=>{
    const own=s.email===currentUser.email.toLowerCase();
    return '<div class="staff-row"><div><strong>'+esc(s.email)+'</strong><small>'+(s.role==='admin'?'Administrador':'Portaria')+' · '+(s.active?'Ativo':'Bloqueado')+'</small></div>'+
      (own?'<span class="badge gold">Sua conta</span>':'<div class="actions"><button class="btn sm outline" data-email="'+esc(s.email)+'" data-action="toggle">'+(s.active?'Suspender':'Reativar')+'</button><button class="btn sm danger" data-email="'+esc(s.email)+'" data-action="remove">Remover</button></div>')+'</div>';
  }).join('');
}
async function saveStaff(ev){
  ev.preventDefault();const email=$('staff-email').value.trim().toLowerCase();
  if(!email)return;
  try{
    const {error}=await api.from('wedding_staff').upsert({email,role:'door',active:true},{onConflict:'email'});
    if(error)throw error;$('staff-email').value='';toast('Perfil da portaria autorizado.');await loadStaff();
  }catch(e){failed(e)}
}
async function handleStaffAction(ev){
  const b=ev.target.closest('[data-action]');if(!b)return;
  const s=staff.find(x=>x.email===b.dataset.email);if(!s||s.email===currentUser.email.toLowerCase())return;
  if(!confirm((b.dataset.action==='remove'?'Remover':'Alterar acesso de')+' '+s.email+'?'))return;
  let result;
  if(b.dataset.action==='remove')result=await api.from('wedding_staff').delete().eq('email',s.email);
  else result=await api.from('wedding_staff').update({active:!s.active}).eq('email',s.email);
  if(result.error)return failed(result.error);toast('Permissão atualizada.');await loadStaff();
}
const headerLookup=(r,...keys)=>{
  for(const k of keys){if(Object.prototype.hasOwnProperty.call(r,k))return r[k]}
  const m=Object.fromEntries(Object.entries(r).map(([k,v])=>[k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim(),v]));
  for(const k of keys){const normalized=k.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim();if(Object.prototype.hasOwnProperty.call(m,normalized))return m[normalized]}
  return '';
};
function boolFromCell(v){return v===true||v===1||['true','verdadeiro','sim','1','yes'].includes(String(v).trim().toLowerCase())}
async function importSheet(){
  const file=$('import-file').files[0];if(!file){return toast('Selecione uma planilha antes de importar.',true)}
  if(!window.XLSX){return toast('Biblioteca de Excel não carregada. Verifique sua conexão.',true)}
  const button=$('start-import');button.disabled=true;button.textContent='Importando…';
  try{
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
    const first=workbook.Sheets[workbook.SheetNames[0]];
    const raw=XLSX.utils.sheet_to_json(first,{defval:'',raw:true});
    const normalized=raw.map(r=>{
      const num=headerLookup(r,'legacy_number','N','Nº');
      const name=String(headerLookup(r,'name','NOME')).trim();
      const guest_type=String(headerLookup(r,'guest_type','TIPO')||'Convidado').trim();
      const list_ok=boolFromCell(headerLookup(r,'list_ok','OK'));
      const invitation_status=String(headerLookup(r,'invitation_status','CONVITES ENVIADOS')||'').trim();
      const rsvp_status=String(headerLookup(r,'rsvp_status','PRESENÇA CONFIRMADA')||'').trim();
      if(!name)return null;
      return {legacy_number:Number(num)>0?Number(num):null,name,guest_type,list_ok,invitation_status,rsvp_status};
    }).filter(Boolean);
    if(!normalized.length)throw Error('Nenhum convidado encontrado. Verifique os cabeçalhos.');
    const uniqueNumbers=new Set(normalized.filter(g=>g.legacy_number).map(g=>g.legacy_number));
    if(uniqueNumbers.size!==normalized.filter(g=>g.legacy_number).length)throw Error('Há números N duplicados na planilha. Corrija antes de importar.');
    if(!confirm('Importar '+normalized.length+' convidados? Convidados de número já existente serão atualizados, mantendo seu QR Code.'))return;
    for(let pos=0;pos<normalized.length;pos+=50){
      const chunk=normalized.slice(pos,pos+50);
      const numbered=chunk.filter(r=>r.legacy_number!==null);
      const unnumbered=chunk.filter(r=>r.legacy_number===null);
      if(numbered.length){const {error}=await api.from('wedding_guests').upsert(numbered,{onConflict:'legacy_number'});if(error)throw error}
      if(unnumbered.length){const {error}=await api.from('wedding_guests').insert(unnumbered);if(error)throw error}
      $('import-summary').textContent=Math.min(pos+50,normalized.length)+' de '+normalized.length+' importados.';
    }
    toast(normalized.length+' convidados importados com sucesso.');await loadGuests();switchTab('guests');
  }catch(e){failed(e)}finally{button.disabled=false;button.textContent='Importar para a lista'}
}
function exportCsv(){
  if(!guests.length)return toast('Não há dados para exportar.',true);
  const keys=['legacy_number','name','guest_type','list_ok','invitation_status','rsvp_status','notes','checked_in_at'];
  const csv=[keys.join(';')].concat(guests.map(g=>keys.map(k=>'"'+String(g[k]??'').replace(/"/g,'""')+'"').join(';'))).join('\r\n');
  const blob=new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob);
  const a=document.createElement('a');a.href=url;a.download='Lista-Privada-Victoria-Levi.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
}

let doorBound=false;
function bindDoor(){
  if(doorBound)return;doorBound=true;
  $('start-camera').addEventListener('click',startCamera);
  $('stop-camera').addEventListener('click',stopCamera);
  $('refresh-stats').addEventListener('click',loadDoorStats);
  $('manual-check').addEventListener('click',()=>lookupCode($('manual-token').value));
  $('manual-token').addEventListener('keydown',e=>{if(e.key==='Enter')lookupCode(e.currentTarget.value)});
  $('scan-result').addEventListener('click',async e=>{
    if(e.target.closest('#confirm-entry'))await confirmEntry();
    else if(e.target.closest('#next-entry'))nextEntry();
  });
  setInterval(()=>{if(currentUser&&!document.hidden)loadDoorStats(true)},30000);
}
async function loadDoorStats(silent=false){
  try{
    const {data,error}=await api.rpc('wedding_gate_stats');if(error)throw error;
    $('door-total').textContent=data.total;$('door-arrived').textContent=data.checked_in;$('door-pending').textContent=data.pending;
  }catch(e){if(!silent)failed(e)}
}
async function startCamera(){
  if(!window.Html5Qrcode)return toast('Leitor de câmera indisponível. Verifique a conexão.',true);
  if(scanner){
    try{scanner.resume();$('start-camera').disabled=true;$('stop-camera').disabled=false;return}catch(_){}
  }
  if(!window.isSecureContext){return toast('Abra o site em HTTPS para usar a câmera.',true)}
  try{
    scanner=new Html5Qrcode('reader');
    await scanner.start({facingMode:'environment'},{fps:10,qrbox:{width:230,height:230}},value=>{
      if(scannerLocked)return;scannerLocked=true;
      try{scanner.pause(true)}catch(_){}
      lookupCode(value);
    },()=>{});
    $('start-camera').disabled=true;$('stop-camera').disabled=false;
    toast('Câmera pronta. Aponte para o QR Code.');
  }catch(e){scanner=null;failed(e,'Não foi possível abrir a câmera.')}
}
async function stopCamera(){
  if(scanner){try{await scanner.stop();await scanner.clear()}catch(e){console.warn(e)}scanner=null}
  scannerLocked=false;$('start-camera').disabled=false;$('stop-camera').disabled=true;
}
function showDoor(data){
  const target=$('scan-result');const status=data.status;
  target.className='scan-result '+(status==='checked_in'?'success':status==='already'?'warn':status==='ready'?'':'error');
  const name=esc(data.name||''),type=esc(data.guest_type||'');
  let html='';
  if(status==='ready'){
    html='<div class="result-icon">✓</div><div class="eyebrow">Convite identificado</div><h2>'+name+'</h2><p class="type">'+type+'</p>'+
      '<p class="subtle">Convidado localizado. Confira o nome e efetive a entrada.</p><button class="btn gold full" id="confirm-entry" style="margin-top:20px">Confirmar entrada</button>';
  }else if(status==='checked_in'){
    html='<div class="result-icon">✓</div><div class="eyebrow">Entrada confirmada</div><h2>'+name+'</h2><p class="type">'+type+'</p><p class="subtle">Entrada registrada às '+esc(dateFmt(data.checked_in_at))+'.</p>'+
      '<button class="btn gold full" id="next-entry" style="margin-top:20px">Ler próximo convidado</button>';
  }else if(status==='already'){
    html='<div class="result-icon">!</div><div class="eyebrow">Entrada já registrada</div><h2>'+name+'</h2><p class="type">'+type+'</p><p class="subtle">Este convite já foi utilizado em '+esc(dateFmt(data.checked_in_at))+'. Não é possível registrar outra entrada.</p>'+
      '<button class="btn outline full" id="next-entry" style="margin-top:20px">Ler próximo convidado</button>';
  }else{
    html='<div class="result-icon">×</div><h2>QR Code inválido</h2><p class="subtle">O código não pertence à lista ou não está mais ativo.</p>'+
      '<button class="btn outline full" id="next-entry" style="margin-top:20px">Tentar novamente</button>';
  }
  target.innerHTML=html;
}
async function lookupCode(value){
  const token=String(value||'').trim();if(!token){scannerLocked=false;return toast('Informe o código do convite.',true)}
  scannedToken=token;
  $('scan-result').innerHTML='<h2>Verificando convite…</h2>';
  try{
    const {data,error}=await api.rpc('wedding_lookup_qr',{p_token:token});if(error)throw error;showDoor(data);
  }catch(e){failed(e);showDoor({status:'invalid'})}
}
async function confirmEntry(){
  const btn=$('confirm-entry');if(btn)btn.disabled=true;
  try{
    const {data,error}=await api.rpc('wedding_confirm_entry',{p_token:scannedToken});
    if(error)throw error;showDoor(data);await loadDoorStats(true);
    if(data.status==='checked_in')toast('Entrada confirmada!');
  }catch(e){failed(e)}finally{if(btn?.isConnected)btn.disabled=false}
}
function nextEntry(){
  scannedToken='';scannerLocked=false;$('manual-token').value='';
  $('scan-result').className='scan-result';
  $('scan-result').innerHTML='<div class="result-icon">◇</div><h2>Aguardando leitura</h2><p class="subtle">Aponte a câmera para o próximo convite.</p>';
  if(scanner){try{scanner.resume()}catch(e){console.warn(e)}}
}
document.addEventListener('DOMContentLoaded',init);
})();