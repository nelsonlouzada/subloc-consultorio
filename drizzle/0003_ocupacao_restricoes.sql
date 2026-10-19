-- Restrições que o Drizzle não modela. É aqui que o BANCO impede conflito de horário e
-- garante a trava entre ocupantes diferentes, mesmo com dois pedidos no mesmo segundo.
CREATE EXTENSION IF NOT EXISTS btree_gist;
--> statement-breakpoint
ALTER TABLE "bloqueio" ADD CONSTRAINT "bloqueio_fim_depois_inicio" CHECK ("fim" > "inicio");
--> statement-breakpoint
-- Exatamente um dos dois preenchido (reserva ou bloqueio).
ALTER TABLE "ocupacao" ADD CONSTRAINT "ocupacao_reserva_ou_bloqueio" CHECK (num_nonnulls("reserva_id", "bloqueio_id") = 1);
--> statement-breakpoint
-- Restrição 1: nada se sobrepõe.
ALTER TABLE "ocupacao" ADD CONSTRAINT "ocupacao_sem_sobreposicao"
  EXCLUDE USING gist ("espaco_id" WITH =, "periodo" WITH &&);
--> statement-breakpoint
-- Restrição 2: trava entre ocupantes diferentes (só vale quando a linha gera trava).
ALTER TABLE "ocupacao" ADD CONSTRAINT "ocupacao_trava_entre_ocupantes"
  EXCLUDE USING gist ("espaco_id" WITH =, "ocupante" WITH <>, "periodo_com_trava" WITH &&) WHERE ("gera_trava");
