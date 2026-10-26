CREATE TABLE "serie" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"espaco_id" uuid NOT NULL,
	"profissional_id" text NOT NULL,
	"dias_semana" smallint[] NOT NULL,
	"frequencia" text NOT NULL,
	"unidade" text NOT NULL,
	"turno_id" uuid,
	"hora_inicio" smallint,
	"hora_fim" smallint,
	"data_inicio" date NOT NULL,
	"data_fim" date NOT NULL,
	"forma_pagamento" text NOT NULL,
	"status" text DEFAULT 'solicitada' NOT NULL,
	"renovacao_de_id" uuid,
	"aprovada_por" text,
	"aprovada_em" timestamp with time zone,
	"motivo_recusa" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "serie_datas_validas" CHECK ("serie"."data_fim" >= "serie"."data_inicio")
);
--> statement-breakpoint
ALTER TABLE "serie" ADD CONSTRAINT "serie_espaco_id_espaco_id_fk" FOREIGN KEY ("espaco_id") REFERENCES "public"."espaco"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serie" ADD CONSTRAINT "serie_profissional_id_profissional_usuario_id_fk" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissional"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serie" ADD CONSTRAINT "serie_turno_id_turno_id_fk" FOREIGN KEY ("turno_id") REFERENCES "public"."turno"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "serie" ADD CONSTRAINT "serie_aprovada_por_usuario_id_fk" FOREIGN KEY ("aprovada_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "serie_profissional_idx" ON "serie" USING btree ("profissional_id");--> statement-breakpoint
CREATE INDEX "serie_espaco_status_idx" ON "serie" USING btree ("espaco_id","status");--> statement-breakpoint
ALTER TABLE "aceite" ADD CONSTRAINT "aceite_serie_id_serie_id_fk" FOREIGN KEY ("serie_id") REFERENCES "public"."serie"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reserva" ADD CONSTRAINT "reserva_serie_id_serie_id_fk" FOREIGN KEY ("serie_id") REFERENCES "public"."serie"("id") ON DELETE no action ON UPDATE no action;