CREATE TABLE "pacote_credito" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"espaco_id" uuid NOT NULL,
	"nome" text NOT NULL,
	"valor_pago_centavos" integer NOT NULL,
	"valor_credito_centavos" integer NOT NULL,
	"ativo" boolean DEFAULT true NOT NULL,
	"criado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pacote_credito_valores" CHECK ("pacote_credito"."valor_pago_centavos" > 0 AND "pacote_credito"."valor_credito_centavos" >= "pacote_credito"."valor_pago_centavos")
);
--> statement-breakpoint
CREATE TABLE "recibo" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"numero" integer GENERATED ALWAYS AS IDENTITY (sequence name "recibo_numero_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 2147483647 START WITH 1 CACHE 1),
	"cobranca_id" uuid NOT NULL,
	"emitido_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "recibo_numero_unique" UNIQUE("numero"),
	CONSTRAINT "recibo_cobranca_id_unique" UNIQUE("cobranca_id")
);
--> statement-breakpoint
ALTER TABLE "cobranca" ADD COLUMN "pix_qr_imagem" text;--> statement-breakpoint
ALTER TABLE "pacote_credito" ADD CONSTRAINT "pacote_credito_espaco_id_espaco_id_fk" FOREIGN KEY ("espaco_id") REFERENCES "public"."espaco"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recibo" ADD CONSTRAINT "recibo_cobranca_id_cobranca_id_fk" FOREIGN KEY ("cobranca_id") REFERENCES "public"."cobranca"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cobranca_item" ADD CONSTRAINT "cobranca_item_pacote_credito_id_pacote_credito_id_fk" FOREIGN KEY ("pacote_credito_id") REFERENCES "public"."pacote_credito"("id") ON DELETE no action ON UPDATE no action;