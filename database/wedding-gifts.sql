
-- Presente 404.SFN: execute APENAS no SQL Editor autorizado do Portal Eetika.
create table if not exists public.wedding_gift_items(
 sku text primary key,room text not null,title text not null,price_cents int not null check(price_cents>0),
 initial_quantity int check(initial_quantity is null or initial_quantity>=0),
 physical_allowed boolean not null,image_url text,active boolean not null default true,
 updated_at timestamptz not null default now()
);
create table if not exists public.wedding_gift_pledges(
 id uuid primary key default gen_random_uuid(),
 item_sku text not null references public.wedding_gift_items(sku),
 gift_mode text not null check(gift_mode in ('physical','value')),
 status text not null check(status in ('reserved','awaiting_payment','paid','cancelled')),
 donor_name text not null,donor_email text not null,message text not null default '',
 base_cents int not null,extra_cents int not null default 0,amount_cents int not null,
 checkout_url text,transaction_nsu text unique,receipt_url text,expires_at timestamptz,
 paid_at timestamptz,notified_at timestamptz,created_at timestamptz not null default now()
);
create index if not exists wg_status_idx on public.wedding_gift_pledges(item_sku,status,expires_at);
alter table public.wedding_gift_items enable row level security;
alter table public.wedding_gift_pledges enable row level security;
revoke all on public.wedding_gift_items,public.wedding_gift_pledges from public,anon,authenticated;
grant select,insert,update on public.wedding_gift_items,public.wedding_gift_pledges to service_role;
-- Não criar policies anon/auth: dados de presenteadores são privados.

create or replace function public.wedding_gift_reserve(
 p_sku text,p_mode text,p_name text,p_email text,p_message text,p_extra_cents int
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare g public.wedding_gift_items%rowtype; taken int; token uuid; st text; exp timestamptz;
begin
 select * into g from public.wedding_gift_items where sku=p_sku and active for update;
 if not found then raise exception 'Item não encontrado'; end if;
 if p_mode not in ('physical','value') then raise exception 'Modalidade inválida'; end if;
 if p_mode='physical' and not g.physical_allowed then raise exception 'Presente físico indisponível'; end if;
 if length(trim(coalesce(p_name,''))) not between 2 and 120 or
    length(trim(coalesce(p_email,''))) not between 5 and 180 or p_email not like '%@%.%'
    then raise exception 'Nome e e-mail obrigatórios'; end if;
 if length(coalesce(p_message,''))>1000 or p_extra_cents not between 0 and 1000000
    then raise exception 'Dados adicionais inválidos'; end if;
 if p_mode='physical' and p_extra_cents<>0 then raise exception 'Extra disponível só para valor'; end if;
 if g.initial_quantity is not null then
   select count(*)::int into taken from public.wedding_gift_pledges p
   where p.item_sku=p_sku and (p.status in ('reserved','paid')
    or (p.status='awaiting_payment' and p.expires_at>now()));
   if taken>=g.initial_quantity then raise exception 'Última unidade já comprometida'; end if;
 end if;
 st:=case when p_mode='physical' then 'reserved' else 'awaiting_payment' end;
 exp:=case when p_mode='value' then now()+interval '30 minutes' else null end;
 insert into public.wedding_gift_pledges(item_sku,gift_mode,status,donor_name,donor_email,message,
 base_cents,extra_cents,amount_cents,expires_at)
 values(g.sku,p_mode,st,trim(p_name),lower(trim(p_email)),coalesce(p_message,''),
 g.price_cents,p_extra_cents,g.price_cents+p_extra_cents,exp) returning id into token;
 return jsonb_build_object('id',token,'amount_cents',g.price_cents+p_extra_cents,'title',g.title,'status',st);
end $$;

create or replace function public.wedding_gift_set_checkout(p_id uuid,p_url text)
returns void language plpgsql security invoker set search_path='' as $$
begin update public.wedding_gift_pledges set checkout_url=p_url where id=p_id and status='awaiting_payment';end $$;

create or replace function public.wedding_gift_cancel(p_id uuid)
returns void language plpgsql security invoker set search_path='' as $$
begin update public.wedding_gift_pledges set status='cancelled' where id=p_id and status='awaiting_payment';end $$;

create or replace function public.wedding_gift_mark_paid(p_id uuid,p_transaction text,p_receipt text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare p public.wedding_gift_pledges%rowtype;
begin
 select * into p from public.wedding_gift_pledges where id=p_id for update;
 if not found or p.gift_mode<>'value' then raise exception 'Pedido inválido';end if;
 if p.status='paid' then return jsonb_build_object('paid',true,'already',true);end if;
 if p.status<>'awaiting_payment' then raise exception 'Pedido não confirmável';end if;
 update public.wedding_gift_pledges set status='paid',paid_at=now(),
 transaction_nsu=left(p_transaction,160),receipt_url=left(p_receipt,1000)
 where id=p_id;
 return jsonb_build_object('paid',true,'already',false);
end $$;

revoke execute on function public.wedding_gift_reserve(text,text,text,text,text,int) from public,anon,authenticated;
revoke execute on function public.wedding_gift_set_checkout(uuid,text) from public,anon,authenticated;
revoke execute on function public.wedding_gift_cancel(uuid) from public,anon,authenticated;
revoke execute on function public.wedding_gift_mark_paid(uuid,text,text) from public,anon,authenticated;
grant execute on function public.wedding_gift_reserve(text,text,text,text,text,int) to service_role;
grant execute on function public.wedding_gift_set_checkout(uuid,text) to service_role;
grant execute on function public.wedding_gift_cancel(uuid) to service_role;
grant execute on function public.wedding_gift_mark_paid(uuid,text,text) to service_role;

insert into public.wedding_gift_items(sku,room,title,price_cents,initial_quantity,physical_allowed,image_url)
values
('CASA-001','Banheiro','ESPELHO',13000,1,true,'https://http2.mlstatic.com/D_NQ_NP_2X_872578-MLA105702060236_012026-F.webp'),
('CASA-002','Banheiro','TOALHA DE ROSTO',12000,NULL,true,'https://m.media-amazon.com/images/I/616SkWK--BL._AC_SX679_.jpg'),
('CASA-003','Banheiro','TOALHAS DE BANHO',39000,NULL,true,'https://m.media-amazon.com/images/I/61HQYb88SqL._AC_SX679_.jpg'),
('CASA-004','Cozinha','AIR-FRYER',26900,NULL,false,'https://m.media-amazon.com/images/I/51NKkmrtVEL._AC_SX679_.jpg'),
('CASA-005','Cozinha','CHALEIRA',8000,NULL,false,'https://m.media-amazon.com/images/I/51K6htcmuWL._AC_SX679_.jpg'),
('CASA-006','Cozinha','COLHERES E ESPÁTULAS',6000,NULL,false,'https://m.media-amazon.com/images/I/51RDO+bHUiL._AC_SX679_.jpg'),
('CASA-007','Cozinha','COOKTOP',30000,NULL,false,'https://m.media-amazon.com/images/I/71uLqItiKiL._AC_SX679_.jpg'),
('CASA-008','Cozinha','COPOS PEQUENOS 6 PC E COPOS GRANDES 6 PC',7000,2,true,'https://m.media-amazon.com/images/I/71G3Lel2HXL._AC_SX679_.jpg'),
('CASA-010','Cozinha','ESCORREDOR DE MACARRÃO',2000,1,true,'https://m.media-amazon.com/images/I/51ETkBYaHgL._AC_SX679_.jpg'),
('CASA-011','Cozinha','FAQUEIRO 36 PC',14500,NULL,false,'https://m.media-amazon.com/images/I/614p7dWdJ0L._AC_SY300_SX300_QL70_ML2_.jpg'),
('CASA-012','Cozinha','FRIGIDEIRAS',30000,3,true,'https://www.lojaredsilver.com.br/wp-content/uploads/2024/01/conjunto-redsilver-v1.png'),
('CASA-013','Cozinha','GELADEIRA',330000,NULL,false,'https://imgs.casasbahia.com.br/55071788/1g.jpg?imwidth=500'),
('CASA-014','Cozinha','JARRAS E GARRAFAS TÉRMICAS',4000,2,true,'https://m.media-amazon.com/images/I/415TBP0GUfL._AC_SY300_SX300_QL70_ML2_.jpg'),
('CASA-015','Cozinha','JOGO DE PANELAS',80000,2,true,'https://convvert.s3.amazonaws.com/profile/6862/products-plans/files/imgplan/c343acb58976/1690400455224kit19.jpg'),
('CASA-016','Cozinha','JOGO DE PRATOS COMPLETO (RASOS, FNDOS E SOBREMESAS)',36000,2,true,'https://m.media-amazon.com/images/I/51HjUseflNS._AC_SY300_SX300_QL70_ML2_.jpg'),
('CASA-018','Cozinha','LIQUIDIFICADOR',20000,1,true,'https://encrypted-tbn1.gstatic.com/shopping?q=tbn:ANd9GcSXvKhez6Kus56ByjkiWqXe74qXmMOouDvFc8gnyt_R0h8bz3OVAIlNDPOf14u8L0mIG7SbOg4CnOOpOgifAH9KB525iXB3tOXFBp0yqONwVQrx99_qn0-icDQ'),
('CASA-019','Cozinha','MICROONDAS',40000,NULL,false,'https://electrolux.vtexassets.com/arquivos/ids/223167-800-800?v=638796393208630000&width=800&height=800&aspect=true&format=auto'),
('CASA-020','Cozinha','PANELA ELÉTRICA DE ARROZ',20000,1,true,'https://www.havan.com.br/media/catalog/product/cache/6e8e24cc73e2eff11526e72b5f24c033/p/a/panela-el_trica-de-arroz-ph5p-visor-glass-philco_1009358_4.jpg'),
('CASA-021','Cozinha','PROCESSADOR',15000,1,true,'https://images.tcdn.com.br/img/img_prod/777993/multiprocessador_turbo_chef_7_em_1_mondial_127v_preto_mpn_01_be_127811_1_d2f33c4ceb9434d17ab6c3aa187eb55d.jpg'),
('CASA-022','Cozinha','SANDUICHEIRA',15000,NULL,false,'https://m.media-amazon.com/images/I/51UxR8FHe-L._AC_SX679_.jpg'),
('CASA-023','Cozinha','TAÇAS',10000,2,true,'https://encrypted-tbn1.gstatic.com/shopping?q=tbn:ANd9GcTlhaxgQm-GJxbYMSKe5sjWhaepIrsfcL6lu49x11P3IPPEWx3NAS_YdvY25hszyD3VpEvNIX8opqPGatPyJ9wBxAnRbPLY'),
('CASA-024','Cozinha','TALHERES 24 PC',9000,NULL,false,'https://http2.mlstatic.com/D_NQ_NP_2X_767591-MLB112371750957_052026-F.webp'),
('CASA-025','Cozinha','TIGELAS',11000,3,true,'https://http2.mlstatic.com/D_NQ_NP_2X_924335-MLB103011318815_122025-F.webp'),
('CASA-026','Cozinha','TUPPERWARE E POTES HERMÉTICOS',9000,4,true,'https://down-br.img.susercontent.com/file/br-11134207-81z1k-mesuqxqzxerld2@resize_w900_nl.webp'),
('CASA-027','Cozinha','XÍCARAS E PIRES',15000,2,true,'https://http2.mlstatic.com/D_NQ_NP_2X_662257-MLA84548072114_052025-F.webp'),
('CASA-028','Lavanderia','ASPIRADOR DE PÓ (ROBÔ)',90000,NULL,false,'https://m.media-amazon.com/images/I/51d+bwNHcaL._AC_SX679_.jpg'),
('CASA-029','Lavanderia','FERRO E TÁBUA DE PASSAR',30000,1,true,'https://http2.mlstatic.com/D_NQ_NP_2X_878977-MLB82959572684_032025-F.webp'),
('CASA-030','Lavanderia','MÁQUINA DE LAVAR (LAVA E SECA)',300000,1,true,'https://electrolux.vtexassets.com/arquivos/ids/213591-800-800?v=637716355481930000&width=800&height=800&aspect=true&format=auto'),
('CASA-031','Quarto','AR-CONDICIONADO',250000,NULL,false,'https://m.media-amazon.com/images/I/61SqDV4ba2L._AC_SX522_.jpg'),
('CASA-032','Quarto','CABIDE (GUARDA-ROUPA)',10000,3,true,'https://m.media-amazon.com/images/I/51m6NvVV70L._AC_SX679_.jpg'),
('CASA-033','Quarto','CAMA',350000,NULL,false,'https://cdn.ortobom.com.br/file/41ba5b4b-8ab3-43c0-9be6-b667bef6707e/liberty_2.png'),
('CASA-034','Quarto','COBERTORES',6500,4,true,'https://m.media-amazon.com/images/I/511zLqXPX2L._AC_SX679_.jpg'),
('CASA-035','Quarto','COLCHA',12000,4,true,'https://m.media-amazon.com/images/I/71W45g89BhL._AC_SY300_SX300_QL70_ML2_.jpg'),
('CASA-036','Quarto','FRONHAS',10000,4,true,'https://encrypted-tbn1.gstatic.com/shopping?q=tbn:ANd9GcQJxZ0XxBio4UT9zFJqrXyPliS7ui4QX7vq0X8pniuihVPS9WYXUe64O6hWqgcInxtIC7sj9DTF1_A6wUQhUg-GlhteLRFtMeuUhVFGjH8oUkv6SIv2aoyoSL4'),
('CASA-037','Quarto','GUARDA-ROUPA',140000,NULL,false,'https://encrypted-tbn3.gstatic.com/shopping?q=tbn:ANd9GcSImhNSfrBBTg9xG90MFv0wM1z8fksFLb9VUBY895LwvX1OruCSeLB1fTGt0K-j6XZos1zm6kXQejQqitQTfO5pcpuxa6xRB7u62zIMc_Y'),
('CASA-038','Quarto','JOGO DE LENÇÓIS',13500,4,true,'https://http2.mlstatic.com/D_NQ_NP_2X_724392-MLA95007996992_102025-F.webp'),
('CASA-039','Quarto','LUMINÁRIA',3000,2,true,'https://encrypted-tbn1.gstatic.com/shopping?q=tbn:ANd9GcSPw8CaKeEqLZyw5gd0VFYgGPUUAaE6aWERn_K8vn3PZR3uZbEUGd9TDCb-7HvJTqHP5gKWXlVCad_1qBUblf_IaElpOWaiiAEu_DswmdU'),
('CASA-040','Quarto','MESA DE CABECEIRA',9000,2,true,'https://down-br.img.susercontent.com/file/br-11134207-7r98o-m7m63h3ndswk28.webp'),
('CASA-041','Quarto','TRAVESSEIROS',10000,4,true,'https://http2.mlstatic.com/D_NQ_NP_2X_750666-MLB86817819868_072025-F.webp'),
('CASA-042','Quarto','CADEIRA DE ESCRITÓRIO',80000,1,true,'https://tokstok.vteximg.com.br/arquivos/ids/29810175-1920-auto/de-escritorio-web-preto-preto-web_st0.jpg?v=638519757096330000&width=1920&height=auto&aspect=true'),
('CASA-043','Quarto','ESCRIVANINHA / MESA',80000,NULL,false,'https://casahuma.cdn.magazord.com.br/img/2024/11/produto/2683/escrivaninha-olivia-com-led-branco-e-amendoa.jpg'),
('CASA-044','Quarto','ESTANTE',44000,NULL,false,'https://product-hub-prd.madeiramadeira.com.br/694330/images/90ebf660-86b2-4b38-a67d-29b69580beeac3e9e8386943301951500x1500.jpg?width=700&canvas=1:1&bg-color=FFF'),
('CASA-045','Quarto','PRATELEIRAS',10000,NULL,false,'https://images.cws.digital/produtos/gg/05/74/kit-3-prateleiras-brancas-40x15-8717405-1695988337074.jpg'),
('CASA-046','Quarto','VENTILADOR',27000,NULL,false,'https://m.magazineluiza.com.br/a-static/420x420/ventilador-de-mesa-arno-xtreme-force-breeze-vb40-40cm-6-pas-3-velocidades-preto-e-azul/magazineluiza/235629500/46e62b7ca6b4b63ec30531e58a5b9151.jpg'),
('CASA-047','Sala','CORTINA C/ BLACKOUT',25000,1,true,'https://http2.mlstatic.com/D_NQ_NP_2X_789125-MLA99509623788_112025-F.webp'),
('CASA-048','Sala','RACK P/ TV',38000,1,true,'https://m.magazineluiza.com.br/a-static/420x420/rack-para-tv-ate-70-1-porta-dj-moveis-flow/magazineluiza/240063600/1aafbdb845a539d18e20b8ec9cabf4e3.jpg'),
('CASA-049','Sala','MESA DE CENTRO',12000,1,true,'https://product-hub-prd.madeiramadeira.com.br/455972864/images/7d9f4a1b-4b2f-4bdf-97eb-17d9226b0f5934259dfc213a2677633b5f98c3.jpg?width=700&canvas=1:1&bg-color=FFF'),
('CASA-050','Sala','POLTRONA',35000,1,true,'https://http2.mlstatic.com/D_NQ_NP_2X_756723-MLB111868559794_062026-F-kit-poltrona-opala-e-puff-redondo-suede-com-almofada-aninha.webp'),
('CASA-051','Sala','SOFÁ',200000,NULL,false,'https://www.ferreiracosta.com/_next/image?url=https%3A%2F%2Fdirogkf3gm8b7.cloudfront.net%2Fproduction%2Fproducts%2F489230%2Fimages%2Fenhanced-media%2F9_360_0449b8bd-d330-438b-8a54-572b60d16475&w=1920&q=100'),
('CASA-052','Sala','TV',350000,NULL,false,'https://m.magazineluiza.com.br/a-static/420x420/smart-tv-50-samsung-uhd-4k-crystal-uhd-u8600f-un50u8600fgxzd-tizen-crystal-4k-bixby-e-alexa-3-hdmi/magazineluiza/240147400/75e1f7e592b5e38e6110ce3e702a3233.jpg'),
('CASA-053','Varanda','APARADOR',17000,1,true,'https://down-br.img.susercontent.com/file/br-11134207-820lj-mo422wmt1nuq82_tn')
on conflict(sku) do update set room=excluded.room,title=excluded.title,price_cents=excluded.price_cents,
initial_quantity=excluded.initial_quantity,physical_allowed=excluded.physical_allowed,image_url=excluded.image_url,active=true,updated_at=now();
update public.wedding_gift_items set active=false where sku not in ('CASA-001','CASA-002','CASA-003','CASA-004','CASA-005','CASA-006','CASA-007','CASA-008','CASA-010','CASA-011','CASA-012','CASA-013','CASA-014','CASA-015','CASA-016','CASA-018','CASA-019','CASA-020','CASA-021','CASA-022','CASA-023','CASA-024','CASA-025','CASA-026','CASA-027','CASA-028','CASA-029','CASA-030','CASA-031','CASA-032','CASA-033','CASA-034','CASA-035','CASA-036','CASA-037','CASA-038','CASA-039','CASA-040','CASA-041','CASA-042','CASA-043','CASA-044','CASA-045','CASA-046','CASA-047','CASA-048','CASA-049','CASA-050','CASA-051','CASA-052','CASA-053');
-- Verificar: select count(*) from public.wedding_gift_items where active; -- 51
