CREATE TABLE "bloqueio" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"espaco_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"inicio" timestamp with time zone NOT NULL,
	"fim" timestamp with time zone NOT NULL,
	"motivo" text,
	"grupo_id" uuid,
	"criado_por" text NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "espaco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"nome" text NOT NULL,
	"slug" text NOT NULL,
	"descricao" text,
	"logradouro" text,
	"numero" text,
	"complemento" text,
	"bairro" text,
	"cidade" text,
	"uf" text,
	"cep" text,
	"comodidades" text[] DEFAULT '{}' NOT NULL,
	"fuso" text DEFAULT 'America/Sao_Paulo' NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "espaco_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "ocupacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"espaco_id" uuid NOT NULL,
	"periodo" "tstzrange" NOT NULL,
	"periodo_com_trava" "tstzrange" NOT NULL,
	"gera_trava" boolean NOT NULL,
	"ocupante" text NOT NULL,
	"reserva_id" uuid,
	"bloqueio_id" uuid,
	CONSTRAINT "ocupacao_reserva_id_unique" UNIQUE("reserva_id"),
	CONSTRAINT "ocupacao_bloqueio_id_unique" UNIQUE("bloqueio_id")
);
--> statement-breakpoint
CREATE TABLE "preco" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"espaco_id" uuid NOT NULL,
	"unidade" text NOT NULL,
	"turno_id" uuid,
	"valor_centavos" integer NOT NULL,
	"vigente_desde" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "regra_espaco" (
	"espaco_id" uuid PRIMARY KEY NOT NULL,
	"dias_funcionamento" smallint[] NOT NULL,
	"abre" time NOT NULL,
	"fecha" time NOT NULL,
	"antecedencia_min_horas" integer NOT NULL,
	"antecedencia_max_dias" integer NOT NULL,
	"duracao_min_horas" integer NOT NULL,
	"trava_minutos" integer NOT NULL,
	"prazo_aprovacao_horas" integer NOT NULL,
	"prazo_pagamento_horas" integer NOT NULL,
	"corte_antes_inicio_horas" integer NOT NULL,
	"validade_credito_dias" integer NOT NULL,
	"desconto_pacote_mes_pct" integer NOT NULL,
	"aviso_renovacao_serie_dias" integer NOT NULL,
	"hora_lembrete_vespera" time NOT NULL,
	"atualizado_por" text,
	"atualizado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "turno" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"espaco_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"inicio" time NOT NULL,
	"fim" time NOT NULL,
	"ordem" integer NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_espaco_id_espaco_id_fk" FOREIGN KEY ("espaco_id") REFERENCES "public"."espaco"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_criado_por_usuario_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocupacao" ADD CONSTRAINT "ocupacao_espaco_id_espaco_id_fk" FOREIGN KEY ("espaco_id") REFERENCES "public"."espaco"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ocupacao" ADD CONSTRAINT "ocupacao_bloqueio_id_bloqueio_id_fk" FOREIGN KEY ("bloqueio_id") REFERENCES "public"."bloqueio"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preco" ADD CONSTRAINT "preco_espaco_id_espaco_id_fk" FOREIGN KEY ("espaco_id") REFERENCES "public"."espaco"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "preco" ADD CONSTRAINT "preco_turno_id_turno_id_fk" FOREIGN KEY ("turno_id") REFERENCES "public"."turno"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regra_espaco" ADD CONSTRAINT "regra_espaco_espaco_id_espaco_id_fk" FOREIGN KEY ("espaco_id") REFERENCES "public"."espaco"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "regra_espaco" ADD CONSTRAINT "regra_espaco_atualizado_por_usuario_id_fk" FOREIGN KEY ("atualizado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turno" ADD CONSTRAINT "turno_espaco_id_espaco_id_fk" FOREIGN KEY ("espaco_id") REFERENCES "public"."espaco"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bloqueio_espaco_inicio_idx" ON "bloqueio" USING btree ("espaco_id","inicio");--> statement-breakpoint
CREATE INDEX "bloqueio_grupo_idx" ON "bloqueio" USING btree ("grupo_id");--> statement-breakpoint
CREATE INDEX "ocupacao_espaco_idx" ON "ocupacao" USING btree ("espaco_id");