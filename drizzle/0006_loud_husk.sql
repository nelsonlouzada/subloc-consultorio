CREATE TABLE "credito_lote" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profissional_id" text NOT NULL,
	"origem" text NOT NULL,
	"valor_inicial_centavos" integer NOT NULL,
	"saldo_centavos" integer NOT NULL,
	"validade_ate" timestamp with time zone NOT NULL,
	"cobranca_id" uuid,
	"reserva_id" uuid,
	"criado_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "credito_lote_saldo_valido" CHECK ("credito_lote"."saldo_centavos" >= 0 AND "credito_lote"."saldo_centavos" <= "credito_lote"."valor_inicial_centavos"),
	CONSTRAINT "credito_lote_valor_positivo" CHECK ("credito_lote"."valor_inicial_centavos" > 0)
);
--> statement-breakpoint
CREATE TABLE "credito_movimento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"lote_id" uuid NOT NULL,
	"tipo" text NOT NULL,
	"valor_centavos" integer NOT NULL,
	"reserva_id" uuid,
	"cobranca_id" uuid,
	"criado_por" text,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "credito_lote" ADD CONSTRAINT "credito_lote_profissional_id_profissional_usuario_id_fk" FOREIGN KEY ("profissional_id") REFERENCES "public"."profissional"("usuario_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credito_lote" ADD CONSTRAINT "credito_lote_cobranca_id_cobranca_id_fk" FOREIGN KEY ("cobranca_id") REFERENCES "public"."cobranca"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credito_lote" ADD CONSTRAINT "credito_lote_reserva_id_reserva_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reserva"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credito_lote" ADD CONSTRAINT "credito_lote_criado_por_usuario_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credito_movimento" ADD CONSTRAINT "credito_movimento_lote_id_credito_lote_id_fk" FOREIGN KEY ("lote_id") REFERENCES "public"."credito_lote"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credito_movimento" ADD CONSTRAINT "credito_movimento_reserva_id_reserva_id_fk" FOREIGN KEY ("reserva_id") REFERENCES "public"."reserva"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credito_movimento" ADD CONSTRAINT "credito_movimento_cobranca_id_cobranca_id_fk" FOREIGN KEY ("cobranca_id") REFERENCES "public"."cobranca"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credito_movimento" ADD CONSTRAINT "credito_movimento_criado_por_usuario_id_fk" FOREIGN KEY ("criado_por") REFERENCES "public"."usuario"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "credito_lote_profissional_validade_idx" ON "credito_lote" USING btree ("profissional_id","validade_ate");--> statement-breakpoint
CREATE INDEX "credito_movimento_lote_idx" ON "credito_movimento" USING btree ("lote_id");