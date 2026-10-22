(function(){'use strict';
const $=id=>document.getElementById(id),config=window.WEDDING_SUPABASE||{};
const supa=window.supabase&&config.url&&config.publishableKey?window.supabase.createClient(config.url,config.publishableKey,{auth:{persistSession:true,detectSessionInUrl:true}}):null;
let pledges=[],gifts=[],token='',bound=false;
const money=cents=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format((cents||0)/100);
const date=s=>new Date(s).toLocaleString('pt-BR',{timeZone:'America/Fortaleza'});
const note=t=>$('notice').textContent=t;
async function api(action,body){const path='/api/gifts?action='+action;const r=await fetch(path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});const d=await r.json().catch(()=>({}));if(!r.ok)throw new Error(d.error||'Falha ao consultar dados');return d}
function dashboard(yes){$('login').hidden=yes;$('dashboard').hidden=!yes;$('logout').hidden=!yes}
async function restore(){if(!supa){note('Conexão não configurada.');return}const {data,error}=await supa.auth.getSession();if(error||!data.session){dashboard(false);return}token=data.session.access_token;try{await load();dashboard(true)}catch(e){dashboard(false);note(e.message||'Este e-mail não está autorizado.');$('error').textContent=e.message}}
async function load(){const d=await api('admin');pledges=d.pledges||[];gifts=d.gifts||[];render()}
const statusLabel={reserved:'Físico reservado',awaiting_payment:'Aguardando pagamento',paid:'Pagamento confirmado',cancelled:'Cancelado'};
function render(){const paid=pledges.filter(p=>p.status==='paid'),reserved=pledges.filter(p=>p.status==='reserved');$('st-physical').textContent=reserved.length;$('st-paid').textContent=paid.length;$('st-awaiting').textContent=pledges.filter(p=>p.status==='awaiting_payment').length;$('st-value').textContent=money(paid.reduce((s,p)=>s+p.amount_cents,0));
const lookup=new Map(gifts.map(g=>[g.sku,g.title]));const q=$('search').value.toLowerCase();const arr=pledges.filter(p=>[p.donor_name,p.donor_email,p.item_sku,lookup.get(p.item_sku)].join(' ').toLowerCase().includes(q));const root=$('rows');root.replaceChildren();
for(const p of arr){const tr=document.createElement('tr');const cell=(text)=>{const td=document.createElement('td');td.textContent=String(text??'');tr.appendChild(td);return td};cell(date(p.created_at));cell(lookup.get(p.item_sku)||p.item_sku);
const donor=cell(p.donor_name);const email=document.createElement('div');email.className='muted';email.textContent=p.donor_email;donor.append(email);
cell(p.gift_mode==='physical'?'Físico':'Valor');
const td=cell('');const badge=document.createElement('span');badge.className='badge '+p.status;badge.textContent=statusLabel[p.status]||p.status;td.append(badge);
const val=cell(p.gift_mode==='value'?money(p.amount_cents):'Entrega física');if(p.extra_cents){const div=document.createElement('div');div.className='muted';div.textContent='Extra: '+money(p.extra_cents);val.append(div)}
cell(p.message||'—');const act=cell('');act.className='actions';
function button(label,fn){const b=document.createElement('button');b.textContent=label;b.onclick=async()=>{b.disabled=true;try{await fn();await load()}catch(e){$('error').textContent=e.message}finally{b.disabled=false}};act.append(b)}
if(p.status==='reserved')button('Cancelar reserva',async()=>{if(confirm('Cancelar o compromisso físico deste presente?'))await api('cancel',{id:p.id})});
if(['reserved','paid'].includes(p.status)&&(!p.notified_at||!p.donor_notified_at))button('Reenviar e-mail',async()=>{const result=await api('retry-notification',{id:p.id});if(!result.sent)throw Error('Configure Resend para enviar e-mail.')});root.append(tr)}}
$('auth-form').addEventListener('submit',async ev=>{ev.preventDefault();if(!supa){note('Configuração Supabase indisponível');return}const b=ev.currentTarget.querySelector('button');b.disabled=true;note('Enviando link seguro…');try{const email=$('auth-email').value.trim();const {error}=await supa.auth.signInWithOtp({email,options:{emailRedirectTo:location.origin+location.pathname,shouldCreateUser:true}});if(error)throw error;note('Abra o link recebido no e-mail autorizado.')}catch(e){note('Não foi possível enviar: '+e.message)}finally{b.disabled=false}});
$('logout').onclick=async()=>{await supa?.auth.signOut();token='';dashboard(false)};
$('refresh').onclick=()=>load().catch(e=>$('error').textContent=e.message);
$('search').addEventListener('input',render);
$('download').onclick=()=>{const data=[['Data','Presente','Nome','Email','Tipo','Status','Valor','Extra','Mensagem'],...pledges.map(p=>[date(p.created_at),gifts.find(g=>g.sku===p.item_sku)?.title||p.item_sku,p.donor_name,p.donor_email,p.gift_mode,p.status,p.amount_cents/100,p.extra_cents/100,p.message])];const cellSafe=x=>{let str=String(x??'');if(/^[\s]*[=+@-]/.test(str))str="'"+str;return '"'+str.replace(/"/g,'""')+'"'};const csv=data.map(r=>r.map(cellSafe).join(';')).join('\r\n');const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.download='presentes-recebidos.csv';a.click();URL.revokeObjectURL(a.href)};
if(supa){supa.auth.onAuthStateChange((_,session)=>{if(session?.access_token){token=session.access_token;setTimeout(restore,0)}else dashboard(false)})}restore();
})();