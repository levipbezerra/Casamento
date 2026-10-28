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

## Testes de aceite

- Admin autenticado: lista dos 118 com filtros/edições, QR individual e arquivo ZIP de 118 PNGs.
- Sem autenticação: nenhuma lista nominal é exibida.
- Operador: somente leitura por QR; não tem SELECT em massa em `wedding_guests`.
- Confirmação uma única vez; nova leitura acusa entrada já registrada.
- Reversão pelo administrador restaura o estado e permite reutilizar o QR.
- Index e módulos da lista de presentes permanecem independentes.
