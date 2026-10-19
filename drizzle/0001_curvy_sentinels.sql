CREATE TABLE "webhook_evento" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provedor" text NOT NULL,
	"evento_id" text NOT NULL,
	"tipo" text NOT NULL,
	"payload" jsonb NOT NULL,
	"recebido_em" timestamp with time zone DEFAULT now() NOT NULL,
	"processado_em" timestamp with time zone,
	"erro" text,
	CONSTRAINT "webhook_evento_evento_id_unique" UNIQUE("evento_id")
);
