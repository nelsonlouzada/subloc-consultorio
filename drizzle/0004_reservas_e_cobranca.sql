CREATE TABLE "aceite" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" text NOT NULL,
	"documento_id" uuid NOT NULL,
	"aceito_em" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"reserva_id" uuid,
	"serie_id" uuid
);
--> statement-breakpoint
CREATE TABLE "cobranca" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profissional_id" text NOT NULL,
	"finalidade" text NOT NULL,
	"valor_bruto_centavos" integer NOT NULL,
	"desconto_centavos" integer DEFAULT 0 NOT NULL,
	"credito_usado_centavos" integer DEFAULT 0 NOT NULL,
	"valor_cobrado_centavos" integer NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"meio" text,
	"marcada_paga_por" text,
	"asaas_cobranca_id" text,
	"asaas_link_fatura" text,
	"pix_copia_cola" text,
	"vence_em" timestamp with time zone,
	"pago_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cobranca_asaas_cobranca_id_unique" UNIQUE("asaas_cobranca_id")
);
--> statement-breakpoint
CREATE TABLE "cobranca_item" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"cobranca_id" uuid NOT NULL,
	"reserva_id" uuid,
	"pacote_credito_id" uuid,
	"valor_centavos" integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documento_legal" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tipo" text NOT NULL,
	"versao" integer NOT NULL,
	"texto" text NOT NULL,
	"publicado_em" timestamp with time zone DEFAULT now() NOT NULL,
	"publicado_por" text,
	CONSTRAINT "documento_legal_tipo_versao_uq" UNIQUE("tipo","versao")
);
--> statement-breakpoint
CREATE TABLE "profissional" (
	"usuario_id" text PRIMARY KEY NOT NULL,
	"cpf" text NOT NULL,
	"profissao" text NOT NULL,
	"conselho" text NOT NULL,
	"registro_numero" text NOT NULL,
	"registro_uf" text NOT NULL,
	"status" text DEFAULT 'pendente' NOT NULL,
	"avaliado_por" text,
	"avaliado_em" timestamp with time zone,
	"motivo_avaliacao" text,
	"asaas_cliente_id" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profissional_cpf_unique" UNIQUE("cpf")
);
--> statement-breakpoint
CREATE TABLE "reserva" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"espaco_id" uuid NOT NULL,
	"profissional_id" text NOT NULL,
	"serie_id" uuid,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone NOT NULL,
	"unidade" text NOT NULL,
	"turno_id" uuid,
	"valor_cheio_centavos" integer NOT NULL,
	"desconto_centavos" integer DEFAULT 0 NOT NULL,
	"valor_centavos" integer NOT NULL,
	"status" text DEFAULT 'solicitada' NOT NULL,
	"prazo_aprovacao_ate" timestamp with time zone,
	"prazo_pagamento_ate" timestamp with time zone,
	"aprovada_por" text,
	"aprovada_em" timestamp with time zone,
	"motivo_recusa" text,
	"cancelada_por" text,
	"cancelada_em" timestamp with time zone,
	"credito_gerado_centavos" integer,
	"codigo_acesso" text,
	"codigo_acesso_enviado_por" text,
	"codigo_acesso_enviado_em" timestamp with time zone,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reserva_fim_depois_inicio" CHECK ("reserva"."fim" > "reserva"."inicio"),
	CONSTRAINT "reserva_valores_validos" CHECK ("reserva"."valor_centavos" >= 0 AND "reserva"."desconto_centavos" >= 0 AND "reserva"."valor_cheio_centavos" >= "reserva"."valor_centavos")
);
--> statement-breakpoint
ALTER TABLE "aceite" ADD CONSTRAINT "aceite_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aceite" ADD CONSTRAINT "aceite_documento_id_documento_legal_id_fk" FOREIGN KEY ("documento_id") REFERENCES "public"."documento_legal"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "aceite" ADD CONSTRAINT "aceite_reserva_id_reserva_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reserva"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranca" ADD CONSTRAINT "cobranca_profissional_id_profissional_usuario_id_fk" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissional"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranca" ADD CONSTRAINT "cobranca_marcada_paga_por_usuario_id_fk" FOREIGN KEY ("marcada_paga_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranca_item" ADD CONSTRAINT "cobranca_item_cobranca_id_cobranca_id_fk" FOREIGN KEY ("cobranca_id") REFERENCES "public"."cobranca"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranca_item" ADD CONSTRAINT "cobranca_item_reserva_id_reserva_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reserva"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "documento_legal" ADD CONSTRAINT "documento_legal_publicado_por_usuario_id_fk" FOREIGN KEY ("publicado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profissional" ADD CONSTRAINT "profissional_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profissional" ADD CONSTRAINT "profissional_avaliado_por_usuario_id_fk" FOREIGN KEY ("avaliado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_espaco_id_espaco_id_fk" FOREIGN KEY ("espaco_id") REFERENCES "public"."espaco"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_profissional_id_profissional_usuario_id_fk" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissional"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_turno_id_turno_id_fk" FOREIGN KEY ("turno_id") REFERENCES "public"."turno"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_aprovada_por_usuario_id_fk" FOREIGN KEY ("aprovada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_cancelada_por_usuario_id_fk" FOREIGN KEY ("cancelada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_codigo_acesso_enviado_por_usuario_id_fk" FOREIGN KEY ("codigo_acesso_enviado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cobranca_profissional_idx" ON "cobranca" USING btree ("profissional_id");--> statement-breakpoint
CREATE INDEX "cobranca_item_cobranca_idx" ON "cobranca_item" USING btree ("cobranca_id");--> statement-breakpoint
CREATE INDEX "cobranca_item_reserva_idx" ON "cobranca_item" USING btree ("reserva_id");--> statement-breakpoint
CREATE INDEX "reserva_profissional_inicio_idx" ON "reserva" USING btree ("profissional_id","inicio");--> statement-breakpoint
CREATE INDEX "reserva_espaco_status_idx" ON "reserva" USING btree ("espaco_id","status");--> statement-breakpoint
ALTER TABLE "ocupacao" ADD CONSTRAINT "ocupacao_reserva_id_reserva_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reserva"("id") ON DELETE cascade ON UPDATE no action;