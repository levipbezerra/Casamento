# Lista de Presentes — Projeto 404.SFN

## Estado da implantação (22/10/2026)
O GitHub contém catálogo, frontend, API Vercel, SQL e painel administrativo. **Isso não significa que o sistema já esteja em produção.** A conexão SQL do Supabase Portal Eetika retornou **28P01 (password authentication failed for supabase_read_only_user)** na verificação de 22/10/2026. Nenhuma migração foi executada e nenhum pagamento real foi testado ou confirmado.

## Fonte única da lista
- Arquivo: `Projeto 404.SFN - Lista de Presentes.xlsx`, aba **CASA**, linhas 3–53.
- Exatamente **51 itens**, somando **R$ 29.544** em valores unitários de referência (a soma **não multiplica** as quantidades).
- 32 permitem entrega física; 19 (`FÍSICO? = NÃO`) aceitam somente valor.
- `QTD. = ∞`: quantidade física sem limite predefinido (NULL no banco).
- `QTD. = X`: modalidade física bloqueada; a contribuição em dinheiro permanece disponível.
- As imagens são referências visuais. A planilha não fornece URL da **página do produto** nem modelo/especificações completos. Não inventar marcas nem vincular a links de compra sem validação.
- Arquivo de catálogo: `gift-catalog.js`.

## Componentes
- `index.html` + `gift-registry.js`: pesquisa aproximada, cartões e formulário de compromisso.
- `api/gifts.js`: Vercel Function; **não** expor chaves no JavaScript do navegador.
- `database/wedding-gifts.sql`: tabelas com RLS, funções transacionais de reserva, catálogo de 51 itens.
- `presentes-admin.html` + `gift-admin.js`: lista de presenteadores, mensagens, extras, situação, CSV, cancelamento físico e reenvio de notificação.
- `wedding-config.js`: contém somente a chave pública do Supabase, nunca a service_role.

## Ativação (ações administrativas)
1. Restaurar a conexão de banco do projeto **Portal Eetika**, ref `kfsyzzecskzbjwnfdipv`. Verificar também se `wedding_staff` e a autenticação de convidados já foram implantadas. **Não** executar migração em outro projeto por engano.
2. No SQL Editor **privado** do projeto, executar `database/wedding-gifts.sql`. Conferir 51 registros ativos e 32 com modalidade física. As funções exigem `service_role` e as tabelas não possuem políticas de leitura anônima.
3. No projeto **Vercel correto**, cadastrar variáveis de ambiente **Production** (sem valores no GitHub):
   - `SUPABASE_URL` — URL do projeto Supabase correspondente;
   - `SUPABASE_SERVICE_ROLE_KEY` — chave secreta server-side;
   - `INFINITEPAY_API_KEY` — chave do Checkout Integrado InfinitePay;
   - `INFINITEPAY_HANDLE` — InfiniteTag sem $;
   - `GIFT_SITE_ORIGIN` — domínio HTTPS final exato (ex.: `https://casamento-psi-two.vercel.app`, apenas após confirmar);
   - `RESEND_API_KEY` — chave server-side do serviço de e-mail;
   - `GIFT_NOTIFY_FROM_EMAIL` — remetente **verificado** no Resend.
4. Ativar **Checkout Integrado** na InfinitePay; as opções do link permitem Pix e cartão. A API utiliza `options.assured_installments = 0`, para não absorver juros, mas a documentação pública **não garante** um limite configurável de 10 parcelas por link. Ajustar e confirmar no seu painel InfinitePay antes de anunciar "até 10x com juros".
5. Verificar o redirect `/index.html?gift_order=...` e webhook HTTPS `/api/gifts?action=webhook` em produção. **Nunca** marcar pagamento como aprovado pelo redirect; é feita consulta autenticada `payment_check` com chave secreta.
6. Autorizar o e-mail administrativo na tabela `wedding_staff` com `role='admin'` e `active=true`, em ambiente privado. Para login por link mágico, incluir a URL HTTPS exata `/presentes-admin.html` nos redirecionamentos Supabase Auth.
7. Testar em ambiente seguro: reserva de 1 unidade; duas reservas concorrentes da última unidade (somente uma deve passar); cancelamento administrativo; contribuição em valor; pagamento aprovado; pagamento não aprovado; notificação e-mail; exportação CSV; filtro por nome com acentos e erros simples.
8. Só divulgar a lista após confirmar o funcionamento e os valores de parcelamento. Não coletar nem compartilhar dados reais para testes.

## Estados
- `reserved`: compromisso físico já reservado, quantidade reduzida imediatamente.
- `awaiting_payment`: cobrança criada ainda **não paga**, segura unidade por 30 minutos.
- `paid`: pagamento validado pela InfinitePay.
- `cancelled`: compromisso cancelado.
- Notificação para `levipbezerra@gmail.com` é disparada após reserva física ou confirmação de pagamento. Se o provedor de email falhar, `notified_at` ficará vazio; o administrador pode usar **Reenviar e-mail** no painel. Não há garantia de entrega enquanto o domínio/remetente não estiver validado.

## Cuidados com privacidade
- O repositório é público, então dados de presenteadores e chaves nunca entram nos commits.
- Tabelas RLS não têm permissões de leitura para `anon` / `authenticated`.
- `/presentes-admin.html` exibe dados **somente** após autenticador Supabase + verificação server-side de `wedding_staff.role='admin'`.
- Ajustes em `database/wedding-setup.sql` (controle de convidados e portaria) foram preservados.

## Verificação da disponibilidade
Enquanto Supabase, InfinitePay ou email não estiverem configurados, o catálogo pode ser visto, mas o frontend **não confirma** compromissos nem apresenta pagamentos fictícios. A API retorna indisponibilidade explicativa.
