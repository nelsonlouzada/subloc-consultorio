CREATE TABLE "notificacao" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"usuario_id" text NOT NULL,
	"tipo" text NOT NULL,
	"canal" text DEFAULT 'email' NOT NULL,
	"assunto" text NOT NULL,
	"status" text NOT NULL,
	"erro" text,
	"referencia_tipo" text NOT NULL,
	"referencia_id" text NOT NULL,
	"enviado_em" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notificacao_tipo_ref_usuario_uq" UNIQUE("tipo","referencia_id","usuario_id")
);
--> statement-breakpoint
ALTER TABLE "notificacao" ADD CONSTRAINT "notificacao_usuario_id_usuario_id_fk" FOREIGN KEY ("usuario_id") REFERENCES "public"."usuario"("id") ON DELETE cascade ON UPDATE no action;