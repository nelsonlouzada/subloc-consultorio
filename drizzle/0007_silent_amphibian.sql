ALTER TABLE "regra_espaco" ADD COLUMN "cancelamento_integral_horas" integer DEFAULT 48 NOT NULL;--> statement-breakpoint
ALTER TABLE "regra_espaco" ADD COLUMN "cancelamento_parcial_horas" integer DEFAULT 24 NOT NULL;--> statement-breakpoint
ALTER TABLE "regra_espaco" ADD COLUMN "cancelamento_parcial_pct" integer DEFAULT 50 NOT NULL;--> statement-breakpoint
ALTER TABLE "reserva" ADD COLUMN "usar_credito" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "regra_espaco" ADD CONSTRAINT "regra_espaco_cancelamento_valido" CHECK ("regra_espaco"."cancelamento_parcial_pct" BETWEEN 0 AND 100 AND "regra_espaco"."cancelamento_parcial_horas" >= 0 AND "regra_espaco"."cancelamento_integral_horas" >= "regra_espaco"."cancelamento_parcial_horas");