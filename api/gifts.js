/* Vercel serverless: nenhuma chave secreta deve ir para arquivos do frontend. */
const URL_BASE = process.env.SUPABASE_URL;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;
const IP_KEY = process.env.INFINITEPAY_API_KEY;
const HANDLE = process.env.INFINITEPAY_HANDLE;
const SITE = process.env.GIFT_SITE_ORIGIN;
const RESEND_KEY = process.env.RESEND_API_KEY;
const SENDER = process.env.GIFT_NOTIFY_FROM_EMAIL;
const TO = 'levipbezerra@gmail.com';
const json=(res,code,data)=>{res.status(code).setHeader('Cache-Control','no-store');res.setHeader('Content-Type','application/json; charset=utf-8');return res.end(JSON.stringify(data))};
const fail=(message,status=400)=>Object.assign(new Error(message),{status});
function requiresDatabase(){if(!URL_BASE||!SERVICE)throw fail('Sistema de reservas aguardando configuração segura do banco.',503)}
function configPayment(){if(!IP_KEY||!HANDLE||!SITE)throw fail('Pagamento InfinitePay ainda não configurado.',503)}
function configNotify(){if(!RESEND_KEY||!SENDER)throw fail('Notificações por e-mail ainda não configuradas.',503)}
async function db(path,method='GET',body){requiresDatabase();const u=URL_BASE.replace(/\/$/,'')+'/rest/v1/'+path;const r=await fetch(u,{method,headers:{apikey:SERVICE,Authorization:'Bearer '+SERVICE,'Content-Type':'application/json',Prefer:method==='POST'?'return=representation':'return=minimal'},body:body===undefined?undefined:JSON.stringify(body)});const t=await r.text();const value=t?(()=>{try{return JSON.parse(t)}catch{return t}})():null;if(!r.ok)throw fail(typeof value==='object'&&value?.message?value.message:'Falha ao processar pedido no banco.',r.status>=500?503:400);return value}
const rpc=(name,payload)=>db('rpc/'+name,'POST',payload);
async function bodyOf(req){if(req.body&&typeof req.body==='object')return req.body;let chunks='';for await(const c of req){chunks+=c;if(chunks.length>24000)throw fail('Pedido muito grande',413)}try{return JSON.parse(chunks||'{}')}catch{throw fail('JSON inválido')}}
const uuid=s=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
async function pledgeOf(id){if(!uuid(id))throw fail('Identificador inválido');const r=await db('wedding_gift_pledges?select=*&id=eq.'+encodeURIComponent(id));return r?.[0]||null}
async function notify(pledge){if(!pledge||pledge.notified_at)return true;if(!RESEND_KEY||!SENDER)return false;
const subject=pledge.gift_mode==='physical'?'Novo compromisso de presente físico':'Presente financeiro confirmado';
const text=['Casamento Victória & Levi',subject,'Presente: '+pledge.item_sku,'Nome: '+pledge.donor_name,'E-mail: '+pledge.donor_email,'Mensagem: '+(pledge.message||'(nenhuma)'),'Tipo: '+pledge.gift_mode,'Valor base: R$ '+(pledge.base_cents/100).toFixed(2),'Extra: R$ '+(pledge.extra_cents/100).toFixed(2),'Pedido: '+pledge.id].join('\n');
const r=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:'Bearer '+RESEND_KEY,'Content-Type':'application/json'},body:JSON.stringify({from:SENDER,to:[TO],subject,text})});
if(!r.ok){console.error('Notificação não entregue:',r.status);return false}
await db('wedding_gift_pledges?id=eq.'+pledge.id,'PATCH',{notified_at:new Date().toISOString()});return true}
async function checkPayment(pledge,transaction,slug){configPayment();if(!transaction||!slug)return {paid:false};const r=await fetch('https://api.checkout.infinitepay.io/payment_check',{method:'POST',headers:{'X-Api-Key':IP_KEY,'Content-Type':'application/json'},body:JSON.stringify({handle:HANDLE,order_nsu:pledge.id,transaction_nsu:transaction,slug})});if(!r.ok)throw fail('InfinitePay temporariamente indisponível para conferência.',502);const d=await r.json();if(!d.paid)return {paid:false};if(d.amount!==undefined&&Number(d.amount)!==pledge.amount_cents)throw fail('Valor conferido não corresponde ao pedido.',409);const marked=await rpc('wedding_gift_mark_paid',{p_id:pledge.id,p_transaction:transaction,p_receipt:d.receipt_url||''});try{await notify(await pledgeOf(pledge.id))}catch(e){console.error('Falha notificando pagamento',e.message)}return {paid:true,already:marked?.already||false}}
async function authenticateAdmin(req){requiresDatabase();const token=(req.headers.authorization||'').replace(/^Bearer /i,'');if(!token||token.length<50)throw fail('Autenticação necessária',401);
const r=await fetch(URL_BASE.replace(/\/$/,'')+'/auth/v1/user',{headers:{apikey:SERVICE,Authorization:'Bearer '+token}});if(!r.ok)throw fail('Sessão inválida',401);const user=await r.json();if(!user.id||!user.email)throw fail('Usuário inválido',401);
const staff=await db('wedding_staff?select=role,active&email=eq.'+encodeURIComponent(user.email.toLowerCase()));if(!staff?.[0]?.active||staff[0].role!=='admin')throw fail('Acesso restrito ao administrador',403);return user}
async function handler(req,res){
const url=new URL(req.url,'https://wedding.local'),action=url.searchParams.get('action');
try{
if(action==='catalog'&&req.method==='GET'){
const items=await db('wedding_gift_items?select=sku,initial_quantity,physical_allowed&active=eq.true');
const pledges=await db('wedding_gift_pledges?select=item_sku,status,expires_at');
const now=Date.now();const taken=new Map();for(const p of pledges||[]){if(['reserved','paid'].includes(p.status)||(p.status==='awaiting_payment'&&new Date(p.expires_at).getTime()>now))taken.set(p.item_sku,(taken.get(p.item_sku)||0)+1)}
return json(res,200,{items:items.map(i=>({sku:i.sku,remaining:!i.physical_allowed?0:i.initial_quantity===null?null:Math.max(0,i.initial_quantity-(taken.get(i.sku)||0))}))})}
if(action==='pledge'&&req.method==='POST'){
requiresDatabase();configNotify();const b=await bodyOf(req);if(!b||typeof b!=='object'||!['value','physical'].includes(b.mode)||typeof b.sku!=='string')throw fail('Presente inválido');
if(b.mode==='value')configPayment();const name=String(b.name||'').trim(),email=String(b.email||'').trim(),msg=String(b.message||'').trim(),extra=Number(b.extra_cents||0);
if(name.length<2||name.length>120||!/^\S+@\S+\.\S+$/.test(email)||email.length>180||msg.length>1000||!Number.isInteger(extra)||extra<0||extra>1000000)throw fail('Dados do presenteador inválidos');
const r=await rpc('wedding_gift_reserve',{p_sku:b.sku,p_mode:b.mode,p_name:name,p_email:email,p_message:msg,p_extra_cents:extra});if(!r?.id||!uuid(r.id))throw fail('Falha ao registrar compromisso',503);
if(b.mode==='physical'){try{await notify(await pledgeOf(r.id))}catch(e){console.error('Falha notificando reserva',e.message)}return json(res,200,{reserved:true,pledge_id:r.id})}
try{
const origin=new URL(SITE);if(origin.protocol!=='https:')throw fail('GIFT_SITE_ORIGIN deve usar HTTPS',503);
const redirect=new URL('/index.html',origin);redirect.searchParams.set('gift_order',r.id);
const webhook=new URL('/api/gifts?action=webhook',origin);
const data={handle:HANDLE,order_nsu:r.id,redirect_url:redirect.href,items:[{quantity:1,price:r.amount_cents,description:'Presente casamento: '+String(r.title).slice(0,80)}],options:{single_payment:true,valid_until:new Date(Date.now()+30*60000).toISOString(),payment_methods_enabled:['credit_card','pix'],assured_installments:0},webhook:{url:webhook.href,events:['paid','refunded','canceled']},customer:{name,email}};
const response=await fetch('https://api.checkout.infinitepay.io/links',{method:'POST',headers:{'X-Api-Key':IP_KEY,'Content-Type':'application/json'},body:JSON.stringify(data)});if(!response.ok)throw fail('Não foi possível criar o link InfinitePay.',502);const result=await response.json();const checkout=result.url||result.checkout_url||result.link||result.data?.url;if(typeof checkout!=='string'||!checkout.startsWith('https://'))throw fail('Checkout não retornou link válido.',502);await rpc('wedding_gift_set_checkout',{p_id:r.id,p_url:checkout});return json(res,200,{checkout_url:checkout,pledge_id:r.id})
}catch(e){await rpc('wedding_gift_cancel',{p_id:r.id}).catch(()=>{});throw e}}
if(action==='verify'&&req.method==='GET'){
const id=url.searchParams.get('order_nsu');const p=await pledgeOf(id);if(!p||p.gift_mode!=='value')throw fail('Pedido não encontrado',404);const transaction=url.searchParams.get('transaction_nsu'),slug=url.searchParams.get('slug');if(p.status==='paid')return json(res,200,{paid:true});if(!transaction||!slug)return json(res,200,{paid:false});const result=await checkPayment(p,transaction,slug);return json(res,200,result)}
if(action==='webhook'&&req.method==='POST'){
const b=await bodyOf(req),id=b.order_nsu,transaction=b.transaction_nsu,slug=b.invoice_slug||b.slug;
const p=await pledgeOf(id);if(!p||!transaction||!slug)throw fail('Evento incompleto ou pedido desconhecido',400);
if(p.status==='paid')return json(res,200,{ok:true,already:true});const result=await checkPayment(p,transaction,slug);return json(res,200,{ok:true,paid:result.paid})}
if(action==='admin'&&req.method==='GET'){
await authenticateAdmin(req);const gifts=await db('wedding_gift_items?select=sku,room,title,price_cents,initial_quantity,physical_allowed&active=eq.true');
const pledges=await db('wedding_gift_pledges?select=*&order=created_at.desc&limit=1000');return json(res,200,{gifts,pledges})}
if(action==='cancel'&&req.method==='POST'){
await authenticateAdmin(req);const b=await bodyOf(req),p=await pledgeOf(b.id);if(!p||p.gift_mode!=='physical'||p.status!=='reserved')throw fail('Somente compromissos físicos podem ser cancelados');await db('wedding_gift_pledges?id=eq.'+p.id,'PATCH',{status:'cancelled'});return json(res,200,{cancelled:true})}
if(action==='retry-notification'&&req.method==='POST'){
await authenticateAdmin(req);const b=await bodyOf(req),p=await pledgeOf(b.id);if(!p||!['reserved','paid'].includes(p.status))throw fail('Compromisso inválido');return json(res,200,{sent:await notify(p)})}
return json(res,404,{error:'Rota não encontrada'});
}catch(e){console.error('Wedding gift error:',e.message);return json(res,e.status||500,{error:e.status&&e.status<500?e.message:'Serviço de presentes indisponível no momento.'})}
}
export default handler;
