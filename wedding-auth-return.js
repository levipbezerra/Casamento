/* Casamento LeVih: conclusão de login por e-mail, mesmo quando o Supabase
   devolve o usuário ao Site URL raiz em vez do redirect solicitado. */
(async function(){
  'use strict';
  const message=document.getElementById('return-message');
  const fail=(msg)=>{
    message.textContent=msg;
    message.style.color='#b63f49';
    document.getElementById('return-actions').hidden=false;
  };
  const clearAuthParams=()=>{
    try{window.history.replaceState(null,'',window.location.pathname)}catch(_){}
  };
  try{
    const hash=new URLSearchParams(window.location.hash.slice(1));
    const query=new URLSearchParams(window.location.search);
    if(hash.has('error')||hash.has('error_code')||query.has('error')){
      const msg=hash.get('error_description')||query.get('error_description')||'O link expirou ou foi recusado.';
      clearAuthParams();
      return fail(msg+' Volte ao painel e solicite um novo link.');
    }
    if(!window.supabase||!window.WEDDING_SUPABASE?.publishableKey)throw Error('Não foi possível carregar a autenticação.');
    const cfg=window.WEDDING_SUPABASE;
    const db=window.supabase.createClient(cfg.url,cfg.publishableKey,{
      auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}
    });
    // getSession aguarda o SDK processar o hash (fluxo implícito) ou o code (PKCE).
    const {data:sessionData,error:sessionError}=await db.auth.getSession();
    if(sessionError)throw sessionError;
    if(!sessionData.session){
      clearAuthParams();
      return fail('Não há uma sessão válida neste navegador. Abra novamente o link mais recente do e-mail ou solicite outro.');
    }
    const {data:userData,error:userError}=await db.auth.getUser();
    if(userError||!userData?.user?.email)throw userError||Error('A sessão não pôde ser validada.');
    const email=userData.user.email.trim().toLowerCase();
    const {data:staff,error:staffError}=await db.from('wedding_staff')
      .select('role,active').eq('email',email).maybeSingle();
    if(staffError)throw staffError;
    clearAuthParams();
    if(!staff?.active||!['admin','door'].includes(staff.role))
      return fail('Este e-mail não está autorizado no casamento. Peça ao administrador para liberar o acesso.');
    let requested='';
    try{
      const saved=JSON.parse(localStorage.getItem('levih-login-intent')||'null');
      localStorage.removeItem('levih-login-intent');
      if(saved&&Date.now()-saved.time<30*60*1000&&['admin','door'].includes(saved.page)){
        requested=saved.page;
      }
    }catch(_){}
    const page=staff.role==='admin'?(requested==='door'?'portaria.html':'convidados.html'):'portaria.html';
    message.textContent='Acesso autorizado. Abrindo '+(page==='convidados.html'?'o painel de convidados…':'a portaria…');
    window.location.replace(window.location.origin+'/'+page);
  }catch(e){
    clearAuthParams();
    console.error('Erro no retorno do login do casamento:',e?.message||e);
    fail('Não foi possível concluir o acesso: '+(e?.message||'erro de autenticação')+'. Solicite um novo link no painel.');
  }
})();
