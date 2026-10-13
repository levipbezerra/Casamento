# Lista de convidados · Victória & Levi

## Rotas separadas

- \`/index.html\` — site atual e presentes (sem alterações);
- \`/convidados.html\` — gestão, exclusivamente administrador;
- \`/portaria.html\` — equipe autorizada, leitura dos QR Codes e confirmação de entrada.

Nenhuma dessas duas rotas foi adicionada ao menu público de presentes.

## Dados e segurança

O repositório \`Casamento\` é **público**. A lista nominal **não está versionada**. Importe-a de forma privada na área autenticada com a planilha original ou com o CSV seguro fornecido ao proprietário.

A camada de dados contém:
- \`wedding_guests\`: cadastro completo, categoria (sem coluna de quem convidou), token UUID aleatório e check-in;
- \`wedding_staff\`: administrador e colaboradores da portaria;
- \`wedding_events\`: trilha de entradas e reversões.
- RLS para permitir acesso nominal em lote **somente ao administrador**. A portaria acessa **um convidado por token** através das funções \`wedding_lookup_qr\` e \`wedding_confirm_entry\`, que verificam autenticação e permissão. O check-in usa bloqueio transacional para impedir duplicidade.
- Código do QR: \`W26:<UUID opaco>\`, **sem nome, telefone ou outros dados pessoais**.
- O administrador pode desfazer uma entrada e testar novamente o mesmo QR.
- Não há cadastro público, lista nominal ou botão de convidado no site de presentes.

## Ativação do banco de dados

O módulo frontend já aponta para a URL e chave **publicável** do projeto Supabase "Portal Eetika" em \`wedding-config.js\` — não é uma credencial privilegiada. Há isolamento por tabelas, funções e regras de acesso próprios.

1. Corrija o acesso PostgreSQL do projeto no Supabase se o banco responder com \`28P01 password authentication failed\`. Sem isso, o frontend não poderá acessar suas tabelas.
2. Execute \`database/wedding-setup.sql\` no SQL Editor do projeto correto. Revise o e-mail de administrador ao final desse arquivo: está predefinido \`levipbezerra2@gmail.com\` pela conta GitHub conectada.
3. Em Supabase Authentication > URL Configuration, adicione os endereços HTTPS exatos de \`convidados.html\` e \`portaria.html\` aos URLs autorizados de redirecionamento de e-mail.
4. Em Authentication, valide a política de signup e disparo de links por e-mail. A interface usa \`signInWithOtp\`: o endereço precisa ser autorizado na tabela \`wedding_staff\` para enxergar dados.
5. Entre em \`convidados.html\` com o e-mail de administrador, faça a importação privada do arquivo completo (118 convidados) e confira o total.
6. Na aba Equipe da portaria, autorize os e-mails da recepção. Essas contas acessam **apenas** \`portaria.html\`.
7. Em \`convidados.html\`, gere os QR Codes para imprimir e colocar nos convites; confirme um teste pela portaria e desfaça a entrada no painel administrativo.

**Atenção:** uma conta GitHub não é automaticamente uma conta de autenticação Supabase. A posse do e-mail deve ser comprovada pelo link mágico.

## Bibliotecas carregadas por CDN

- \`@supabase/supabase-js@2.58.0\` (autenticação, RLS, PostgREST)
- \`qrcodejs@1.0.0\` (geração visual do QR)
- \`html5-qrcode@2.3.8\` (câmera do recepcionista)
- \`xlsx@0.18.5\` (importação local sem upload de arquivo para outro serviço)

O frontend precisa de conexão à internet e HTTPS para uso da câmera. Nenhum arquivo de convidados é gravado no repositório. A planilha é lida no navegador autenticado e os dados permitidos são enviados ao banco.

## Verificações de aceite

- Sem login, ambas as páginas não mostram convidados.
- Perfil portaria não deve conseguir \`select * from wedding_guests\` via REST.
- Perfil administrador vê e edita os 118 registros; duplicidade de nomes mantém QR individual.
- Uma entrada válida é aceita uma única vez; leitura repetida mostra "Já entrou".
- A reversão pelo administrador apaga \`checked_in_at\` e volta a permitir entrada.
- Cada edição de nome e tipo preserva \`qr_token\`.
- O site original de presentes continua inalterado.

**Status de implementação:** os arquivos de interface, lógica e SQL estão no GitHub. A aplicação em produção depende de concluir a migração do banco, cadastrar os e-mails/redirects e importar a lista privadamente. Não declare sincronização ativa até validar esses passos.

## Hospedagem declarada no GitHub

O repositório informa o endereço `https://casamento-psi-two.vercel.app`. Após confirmar o deploy, os caminhos previstos são `/convidados.html` e `/portaria.html`. O projeto não apareceu na conta Vercel conectada a esta conversa, portanto não foi possível verificar que esses caminhos já estão disponíveis na publicação.
