# Casamento Victória & Levi — painel privado de convidados e portaria

## Aplicação publicada

- Site público e presentes: `https://levievictoria.vercel.app/`
- Administração exclusiva: `https://levievictoria.vercel.app/convidados.html`
- Recepção (operadores autorizados): `https://levievictoria.vercel.app/portaria.html`
- Repositório: `levipbezerra/Casamento`, branch `main`; Vercel `levievictoria`.
- Os módulos de convidados/portaria **não aparecem no menu público** nem dependem da lista de presentes.

## Banco e estado confirmado — 28/10/2026

- Projeto Supabase pessoal `fgmhrekiowkfrqvhxorw`, chave apenas **publicável** em `wedding-config.js`.
- `public.wedding_guests`: 118 registros importados em particular, 8 categorias, 118 tokens UUID exclusivos. Nenhum check-in marcado na importação.
- `public.wedding_staff`: 1 administrador ativo e nenhum operador de portaria pré-autorizado. A administração pode cadastrar operadores pela interface.
- `public.wedding_events`: trilha de confirmação e reversão. `RLS` está ativada nas três tabelas.
- As informações nominais nunca são inseridas no GitHub público. Não publique exportações, tokens individuais nem listas de convidados.
- **Não execute novamente o SQL de criação sem necessidade**; a estrutura já existe. Uma nova importação com o mesmo número atualiza o cadastro preservando QR Codes e histórico de entrada.

## Fluxo de acesso

1. Abra `/convidados.html`; informe o e-mail cadastrado como administrador e use o link de login recebido por e-mail.
2. Em **Convidados**, busque, filtre, adicione, edite, exclua, confirme ou desfaça entrada. Editar nome/categoria não altera o token do QR.
3. Em **Importação e exportação**, baixe um QR individual na coluna de ações ou use **Baixar todos os QR Codes (.ZIP)** para gerar 118 artes PNG privadamente no navegador. O ZIP pode ser utilizado para posicionar cada QR no exibível correspondente.
4. Em **Equipe da portaria**, autorize o e-mail de cada recepcionista. Cada um entra pelo link separado `/portaria.html`.
5. Na portaria, leia o QR usando a câmera em HTTPS ou digite o código manual. O operador confere nome/categoria e clica **Confirmar entrada**.
6. Segunda leitura indica **Já entrou**. Para testar antes da cerimônia, use **Desfazer entrada** no painel administrativo e escaneie novamente. Esse reset é de uso exclusivo do administrador.
7. O QR contém apenas `W26:<UUID>`. Jamais transmite nome/telefone ou dados pessoais no código.

## Segurança

- O painel exige autenticação Supabase e perfil `admin` registrado na tabela `wedding_staff`.
- A portaria exige autenticação e papel `door` ou `admin`.
- Apenas o administrador acessa a listagem de convidados em massa. O operador pode consultar **um token por vez** por meio de RPCs do banco.
- RPCs `wedding_lookup_qr`, `wedding_confirm_entry` e `wedding_gate_stats` confirmam `auth.uid()` e papel autorizado. Check-in usa lock de linha na transação para evitar duplicidade.
- `anon` não tem permissão para ler tabelas de convidados/equipe/eventos; RLS protege os dados. Não substitua chave publicável por `service_role` no frontend.
- A autorização e os redirects de login são diferentes das proteções de implantação configuradas no Vercel.

## Configuração operacional a confirmar no painel Supabase

O conector atual não oferece ajustes de **Authentication > URL Configuration** nem do provedor SMTP. Um administrador deve validar estes itens na console do projeto:

- Adicionar `https://levievictoria.vercel.app/convidados.html` e `https://levievictoria.vercel.app/portaria.html` à lista **Redirect URLs** de Auth.
- Garantir a entrega de Magic Links, inclusive para e-mails da equipe; o SMTP padrão de Supabase pode exigir configuração própria para destinatários externos.
- Fazer login real na administração e na portaria por uma conta autorizada. Não considere a leitura de câmera verificada até executar esse teste em dispositivo HTTPS.
- Se o domínio `vercel.app` exigir SSO do Vercel, revisar a política de proteção do projeto para permitir acesso ao site público. Isso não substitui a autenticação privada das áreas de convidados/portaria.

## Atualização para a planilha de 110 convidados — 28/10/2026

A planilha atual possui **110 pessoas na relação principal** e um segundo bloco com **8 integrantes da equipe de apoio** (7 Banda, 1 Cerimonialista). Esses 8 registros não devem inflar os indicadores da lista principal.

A sincronização em `/convidados.html` → **Importação e exportação**:
1. Aceita a planilha `.xlsx` original ou CSV privado com cabeçalhos `legacy_number`, `name`, `guest_type`, `list_ok`, `invitation_status`.
2. Detecta o bloco secundário da planilha após a separação e não o inclui nos totais da relação principal.
3. Compara os nomes completos ou correspondências de primeiro nome e tipo que sejam únicas, **sem vincular QR Codes pelo número original**.
4. Informa previamente quantas pessoas conservarão o QR, quantas terão QR novo e quem sairá da lista, e solicita confirmação.
5. Baixa um backup privado dos cadastros e QR Codes antes de executar alterações.
6. Libera os números antigos, atualiza identidades correspondentes, cria novos registros, remove os ausentes (somente se não houver check-in), recarrega e valida o total e os nomes.
7. Preserva `rsvp_status` quando a planilha não contém essa coluna e preserva os tokens de QR das correspondências únicas.

**Importante:** não publique o arquivo de convidados ou seus QR Codes no repositório público. A atualização da interface não altera automaticamente dados do banco; a pessoa autorizada precisa importar o arquivo uma vez pelo próprio painel.

## Acesso por duas formas — 28/10/2026

A administração e a portaria oferecem **E-mail e senha** (padrão) ou **Link por e-mail**. O login com senha usa `supabase.auth.signInWithPassword` e não envia e-mail; o link continua via `supabase.auth.signInWithOtp`.

- O administrador `levipbezerra2@gmail.com` possui usuário confirmado e senha já registrada no Supabase pessoal. **A alteração do frontend não modifica essa senha**.
- Não há cadastro público de administradores. A solicitação de Magic Link pela administração usa `shouldCreateUser:false`.
- Operadores autorizados pela gestão em `wedding_staff` podem solicitar seu primeiro link de portaria e criar uma conta verificada, com `shouldCreateUser:true` apenas na portaria. O acesso aos dados continua bloqueado por RLS e pelas funções que validam o papel autorizado.
- Depois de entrar por qualquer método, use **Alterar senha**. A atualização usa `supabase.auth.updateUser` na sessão do próprio usuário e exige confirmação de uma senha de pelo menos 12 caracteres no formulário.
- Se o Supabase retornar `email rate limit exceeded`, o login com **senha já existente** continua sem depender da cota de envio de e-mails. Se o usuário não souber sua senha, será necessário recuperar o acesso por um método de identidade válido quando o serviço de envio estiver disponível, ou providenciar recuperação administrativa pelo provedor de autenticação.
- Nunca coloque senhas, hashes, `service_role` ou tokens de QR em arquivos públicos do GitHub.

## Recuperação do redirecionamento de e-mail (28/10/2026)

O Supabase pode ignorar o `emailRedirectTo` da área privada se o endereço não estiver na allowlist de Auth, ou se o template usar a URL inicial em vez da URL de retorno. Nesses casos, o Magic Link válido chega a `/` com `#access_token=...` (fluxo implícito) ou `?code=...` (PKCE).

A página pública agora contém um handler **exclusivamente para callbacks de autenticação**. Ele encaminha o retorno para `/wedding-auth-return.html`, onde a sessão é processada pelo SDK, a autorização do e-mail é verificada em `wedding_staff`, os parâmetros sensíveis são retirados da URL e o usuário é redirecionado à área permitida. O login guarda apenas a preferência de destino (admin ou portaria), nunca nomes ou QR Codes, com validade curta. Sem callback, o site público permanece intacto.

**Após essa alteração, solicite e use um NOVO Magic Link.** Links já consumidos não podem ser reutilizados. Verifique em navegador que recebe o link a mesma origem em que se inicia o login; outros navegadores podem não compartilhar sessão. Se o fluxo falhar, consulte `Authentication → URL Configuration` e os modelos de e-mail do Supabase. O fallback não substitui configuração oficial de URL nem teste real do recebimento de e-mail.

## Testes de aceite

- Admin autenticado: lista dos 118 com filtros/edições, QR individual e arquivo ZIP de 118 PNGs.
- Sem autenticação: nenhuma lista nominal é exibida.
- Operador: somente leitura por QR; não tem SELECT em massa em `wedding_guests`.
- Confirmação uma única vez; nova leitura acusa entrada já registrada.
- Reversão pelo administrador restaura o estado e permite reutilizar o QR.
- Index e módulos da lista de presentes permanecem independentes.
