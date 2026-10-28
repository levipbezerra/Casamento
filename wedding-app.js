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
  $('auth-shell').hidden=isLogged;$('app-shell').hidden=!isLogged;
  $('logout-btn').hidden=!isLogged;$('change-password-btn').hidden=!isLogged;
  if(!isLogged)$('password-modal').hidden=true;
  if(!isLogged&&$('account-label'))$('account-label').textContent=PAGE==='admin'?'Gestão dos convidados':'Check-in de convidados';
}
function missingSetup(){
  $('auth-message').textContent='A base de dados ainda não foi configurada. O administrador deve executar database/wedding-setup.sql e revisar wedding-config.js.';
  $('auth-message').style.color='#a53f49';
  $('auth-form').querySelector('button').disabled=true;
  $('password-form').querySelector('button').disabled=true;
}
async function init(){
  setViewAuth(false);
  $('auth-form').addEventListener('submit',requestMagicLink);
  $('password-form').addEventListener('submit',signInPassword);
  $('auth-tab-password').addEventListener('click',()=>setAuthMethod('password'));
  $('auth-tab-link').addEventListener('click',()=>setAuthMethod('link'));
  $('change-password-btn').addEventListener('click',()=>{$('password-modal').hidden=false;$('new-password').focus()});
  $('close-password-modal').addEventListener('click',closePasswordModal);
  $('cancel-password-modal').addEventListener('click',closePasswordModal);
  $('update-password-form').addEventListener('submit',updatePassword);
  setAuthMethod('password');
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
      setTimeout(()=>{if(session.user.id!==currentUser?.id)restore(session.user)},0);
    }
  });
}

function setAuthMethod(method){
  const password=method==='password';
  // Carry the typed e-mail between login methods without storing credentials.
  const from=$(password?'auth-email':'password-email'),to=$(password?'password-email':'auth-email');
  if(!to.value&&from.value)to.value=from.value;
  $('password-form').hidden=!password;
  $('auth-form').hidden=password;
  $('auth-tab-password').classList.toggle('active',password);
  $('auth-tab-link').classList.toggle('active',!password);
  $('auth-tab-password').setAttribute('aria-selected',String(password));
  $('auth-tab-link').setAttribute('aria-selected',String(!password));
  $('auth-message').textContent=password?
    'Entre com a senha da sua conta. Não é necessário solicitar um e-mail.':
    'O link é uma alternativa e pode estar sujeito ao limite de envio do Supabase.';
}
async function signInPassword(event){
  event.preventDefault();
  if(!api){missingSetup();return}
  const email=$('password-email').value.trim().toLowerCase();
  const password=$('password-secret').value;
  const button=event.currentTarget.querySelector('button');
  button.disabled=true;
  $('auth-message').textContent='Verificando suas credenciais…';
  try{
    const {data,error}=await api.auth.signInWithPassword({email,password});
    if(error)throw error;
    $('password-secret').value='';
    if(!data?.user)throw Error('Não foi possível autenticar esta conta.');
    await restore(data.user);
  }catch(error){
    console.error('Falha ao autenticar com senha:',error?.code||error?.name);
    const message=String(error?.message||'').toLowerCase();
    $('auth-message').textContent=message.includes('invalid login credentials')?
      'E-mail ou senha inválidos. Confira a senha cadastrada ou use o link por e-mail.':
      message.includes('rate limit')?
      'Muitas tentativas de acesso. Aguarde o limite de segurança e tente novamente.':
      'Falha no acesso: '+(error?.message||'tente novamente.');
    toast($('auth-message').textContent,true);
  }finally{button.disabled=false}
}
function closePasswordModal(){
  $('password-modal').hidden=true;
  $('update-password-form').reset();
  $('update-password-message').textContent='Sua senha não é salva neste site.';
}
async function updatePassword(event){
  event.preventDefault();
  const password=$('new-password').value,confirmation=$('confirm-password').value,
    current=$('current-password').value;
  const message=$('update-password-message'),button=event.currentTarget.querySelector('button[type="submit"]');
  if(password.length<12){message.textContent='Use pelo menos 12 caracteres.';return}
  if(password!==confirmation){message.textContent='As senhas informadas não são iguais.';return}
  button.disabled=true;message.textContent='Atualizando sua senha com segurança…';
  try{
    const update={password};
    if(current)update.current_password=current;
    const {error}=await api.auth.updateUser(update);
    if(error)throw error;
    message.textContent='Senha atualizada. Ela já pode ser usada na gestão e na portaria.';
    $('update-password-form').reset();
    toast('Sua senha foi atualizada.');
    setTimeout(()=>{if(!$('password-modal').hidden)closePasswordModal()},1800);
  }catch(error){
    console.error('Falha ao mudar a senha:',error?.code||error?.name);
    message.textContent='Não foi possível alterar a senha: '+(error?.message||'verifique sua sessão e tente novamente.');
  }finally{button.disabled=false}
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
    const {error}=await api.auth.signInWithOtp({email,options:{emailRedirectTo:redirect,shouldCreateUser:PAGE==='door'}});
    if(error)throw error;
    $('auth-message').textContent='Verifique sua caixa de entrada. Abra o link neste dispositivo para acessar.';
    toast('Link enviado. Confira seu e-mail.');
  }catch(e){
    console.error('Falha no envio do link de acesso:',e?.code||e?.name);
    const limited=/rate limit|too many requests|over_email_send_rate_limit/i.test(String(e?.message||'')+' '+String(e?.code||''));
    $('auth-message').textContent=limited?
      'O limite de envio de e-mails foi atingido. Se já possui senha, selecione E-mail e senha para entrar sem aguardar o limite.':
      'Não foi possível enviar o link. Confira a configuração de autenticação e tente novamente.';
    toast($('auth-message').textContent,true);
  }finally{button.disabled=false}
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
    if(PAGE==='door'&&$('back-admin'))$('back-admin').hidden=data.role!=='admin';
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
  $('copy-door-link').addEventListener('click',()=>{const url=new URL('portaria.html',window.location.href).href;navigator.clipboard?.writeText(url).then(()=>toast('Link da portaria copiado.')).catch(()=>window.prompt('Copie o link da portaria:',url))||window.prompt('Copie o link da portaria:',url)});
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
// Importação de planilhas completas: separa a lista principal do bloco de equipe.
// O campo N não é identidade. Nunca transferir QR Codes com base no N isoladamente.
const normalizeHeader=s=>String(s??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').trim().toLocaleLowerCase('pt-BR');
const identityKey=s=>normalizeHeader(s).replace(/[^a-z0-9]+/g,' ').trim();
const firstNameKey=s=>identityKey(s).replace(/^(tia|tio|pr|pastor|pastora) /,'').split(' ')[0];
function boolFromCell(v){return v===true||v===1||['true','verdadeiro','sim','1','yes','ok'].includes(String(v).trim().toLowerCase())}
function parseGuestWorkbook(workbook){
  const sheet=workbook.Sheets[workbook.SheetNames[0]];
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:true});
  const headers=(matrix[0]||[]).map(normalizeHeader);
  const col=(...names)=>headers.findIndex(h=>names.includes(h));
  const nc=col('n','nº','numero','legacy_number'),namec=col('nome','name'),typec=col('tipo','guest_type');
  const okc=col('ok','list_ok'),invitec=col('convites enviados','invitation_status');
  const rsvpc=col('presenca confirmada','rsvp_status');
  if(nc<0||namec<0||typec<0)throw Error('A planilha precisa ter as colunas N, NOME e TIPO.');
  const records=[],seen=new Set();
  let divider=false,support=false,ignored=0,lastNum=0;
  for(const line of matrix.slice(1)){
    const n=Number(line[nc]),name=String(line[namec]??'').trim();
    if(!name||!Number.isInteger(n)||n<1){if(records.length)divider=true;continue}
    if(!support&&divider&&n<=lastNum){support=true}
    if(support){ignored++;continue}
    if(seen.has(n))throw Error('O número '+n+' aparece duas vezes no bloco principal.');
    if(n<=lastNum)throw Error('A numeração da lista principal não está em ordem. Confira a planilha.');
    const guest_type=String(line[typec]||'Convidado').trim();
    if(name.length>180||guest_type.length>70)throw Error('Nome ou tipo excede o limite no número '+n);
    const item={legacy_number:n,name,guest_type,list_ok:okc<0?false:boolFromCell(line[okc]),
      invitation_status:invitec<0?'':String(line[invitec]??'').trim()};
    if(rsvpc>=0)item.rsvp_status=String(line[rsvpc]??'').trim();
    records.push(item);seen.add(n);lastNum=n;divider=false;
  }
  if(!records.length)throw Error('Nenhum convidado válido foi localizado no primeiro bloco.');
  return {records,ignored};
}
function reconcileGuests(rows,current){
  const used=new Set(),matched=[],added=[];
  const result=[];
  const findCandidate=row=>{
    let pool=current.filter(g=>!used.has(g.id)&&identityKey(g.name)===identityKey(row.name));
    if(pool.length!==1){
      // Somente apelido ↔ nome ampliado quando há um candidato único no mesmo tipo.
      pool=current.filter(g=>!used.has(g.id)&&g.guest_type===row.guest_type&&
        firstNameKey(g.name)===firstNameKey(row.name)&&firstNameKey(row.name).length>=3);
    }
    return pool.length===1?pool[0]:null;
  };
  for(const row of rows){
    const old=findCandidate(row);
    if(old){
      used.add(old.id);
      // Ausência de coluna de presença confirmada não apaga RSVP já registrado.
      matched.push({...row,id:old.id,...(!Object.hasOwn(row,'rsvp_status')?{rsvp_status:old.rsvp_status}:{} )});
    }else{
      added.push(row);
    }
    result.push({row,old});
  }
  const removed=current.filter(g=>!used.has(g.id));
  return {matched,added,removed,result};
}
function privateBackup(list){
  const cols=['id','legacy_number','name','guest_type','list_ok','invitation_status','rsvp_status','notes','qr_token','checked_in_at'];
  const data=[cols.join(';')].concat(list.map(g=>cols.map(k=>'"'+String(g[k]??'').replace(/"/g,'""')+'"').join(';'))).join('\r\n');
  const url=URL.createObjectURL(new Blob(['\ufeff'+data],{type:'text/csv;charset=utf-8'}));
  const a=document.createElement('a');a.href=url;a.download='BACKUP-PRIVADO-LeVih-antes-da-importacao.csv';a.click();
  setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function importSheet(){
  const file=$('import-file').files[0];
  if(!file)return toast('Selecione a planilha atualizada antes de importar.',true);
  if(!window.XLSX)return toast('Leitor Excel indisponível. Verifique sua conexão.',true);
  const button=$('start-import');button.disabled=true;button.textContent='Conferindo a planilha…';
  const summary=$('import-summary');
  try{
    const workbook=XLSX.read(await file.arrayBuffer(),{type:'array',cellDates:false});
    const {records,ignored}=parseGuestWorkbook(workbook);
    // Busca estado atual imediatamente antes da sincronização.
    const existing=[];for(let start=0;;start+=1000){
      const {data,error}=await api.from('wedding_guests').select('*').order('name').range(start,start+999);
      if(error)throw error;
      existing.push(...data);if(data.length<1000)break;
    }
    const plan=reconcileGuests(records,existing);
    if(plan.removed.some(g=>g.checked_in_at))
      throw Error('Há entradas já registradas em pessoas fora da nova lista. Desfaça essas entradas antes de substituir a relação.');
    const previewList=items=>items.slice(0,15).map(g=>'• '+g.name).join('\n')+(items.length>15?'\n… e mais '+(items.length-15):'');
    const details='LISTA PRINCIPAL: '+records.length+' convidados\n'+
      'QR Codes preservados por identidade: '+plan.matched.length+'\n'+
      'Novos QR Codes necessários: '+plan.added.length+'\n'+
      'Registros antigos fora da lista: '+plan.removed.length+'\n'+
      'Equipe no segundo bloco (não importada): '+ignored+'\n\n'+
      'A numeração será atualizada, as pessoas ausentes serão retiradas e '+
      'o sistema baixará um backup privado antes da alteração. '+
      'Registros sem correspondência única terão um NOVO QR Code.\n\n'+
      (plan.added.length?'NOVOS QR Codes:\n'+previewList(plan.added)+'\n\n':'')+
      (plan.removed.length?'REGISTROS QUE SAIRÃO DA LISTA:\n'+previewList(plan.removed)+'\n\n':'')+
      'Confirmar sincronização?';
    summary.textContent='Prévia: '+records.length+' convidados; '+plan.matched.length+' QR Codes preservados; '+
      plan.added.length+' novos; '+plan.removed.length+' removidos; '+ignored+' da equipe separados.';
    if(!confirm(details))return;
    privateBackup(existing);
    button.textContent='Sincronizando convidados…';
    // Libera números antigos antes de reagrupar, sem jamais trocar IDs/tokens entre pessoas.
    for(let i=0;i<existing.length;i+=40){
      const slice=existing.slice(i,i+40);
      const {error}=await api.from('wedding_guests').update({legacy_number:null}).in('id',slice.map(g=>g.id));
      if(error)throw error;
    }
    for(let i=0;i<plan.matched.length;i+=25){
      const payload=plan.matched.slice(i,i+25);
      const {error}=await api.from('wedding_guests').upsert(payload,{onConflict:'id'});
      if(error)throw error;
      summary.textContent='Atualizados: '+Math.min(i+25,plan.matched.length)+' de '+plan.matched.length;
    }
    for(let i=0;i<plan.added.length;i+=25){
      const {error}=await api.from('wedding_guests').insert(plan.added.slice(i,i+25));
      if(error)throw error;
    }
    for(let i=0;i<plan.removed.length;i+=40){
      const {error}=await api.from('wedding_guests').delete().in('id',plan.removed.slice(i,i+40).map(g=>g.id));
      if(error)throw error;
    }
    await loadGuests();
    const actualByNumber=new Map(guests.map(g=>[g.legacy_number,g]));
    if(guests.length!==records.length||records.some(x=>!actualByNumber.has(x.legacy_number)||
      actualByNumber.get(x.legacy_number).name!==x.name||
      actualByNumber.get(x.legacy_number).guest_type!==x.guest_type)){
      throw Error('Os dados gravados não coincidem com a planilha. Confira o painel e execute novamente a importação.');
    }
    summary.textContent='Sincronização conferida: '+guests.length+' convidados, '+plan.matched.length+
      ' QR Codes preservados e '+plan.added.length+' novos. '+ignored+' registros de apoio ignorados.';
    toast('A lista foi atualizada e conferida com '+guests.length+' convidados.');
    switchTab('guests');
  }catch(e){
    failed(e);
    summary.textContent='Sincronização não concluída. '+(e.message||'Confira os registros e tente importar novamente.');
  }finally{
    button.disabled=false;button.textContent='Conferir e sincronizar lista';
  }
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