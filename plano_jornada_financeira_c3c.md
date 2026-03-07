# Plano de Execução: Jornada Financeira e Fechamento de Período C3C (V1)

Este documento detalha a arquitetura de automação e o fluxo de estados para o fechamento de período, separando claramente os status dos lançamentos individuais (Logs) do status macro do período. Esta versão (V1) foca em transições manuais para as etapas bancárias.

## 1. Status dos Lançamentos (LancamentoHora__c)
Estes status são movimentados por **ações do usuário** (botões) nas interfaces:
*   **Rascunho:** Estado inicial do apontamento.
*   **Em aprovação do serviço:** Colaborador enviou o log para revisão técnica (Líder).
*   **Em aprovação do RH:** Líder aprovou o log, pendente revisão administrativa.
*   **Reprovado serviço:** Líder técnico devolveu o log.
*   **Reprovado RH:** Backoffice administrativo devolveu o log.
*   **Aprovado:** Log validado por todos os níveis e pronto para faturamento/pagamento.

---

## 2. Status do Período (Periodo__c) - O Funil de Automação V1
O status do período evolui via Jobs automáticos até a fase de NF, e via ações do Financeiro nas fases bancárias:

1.  **Aberto:** Colaborador editando o mês.
2.  **Aguardando Aprovação Líder:** Job move automaticamente se todos os dias úteis estão preenchidos (`DiaCompleto__c = True`).
3.  **Aguardando Aprovação RH:** Job move automaticamente se todos os logs do período avançaram para "Em aprovação do RH".
4.  **Liberado para Nota Fiscal:** Job move automaticamente se todos os logs do período estão como "Aprovado".
5.  **Nota em Validação:** Movido instantaneamente no upload da NF pelo colaborador.
6.  **Pronto para Pagamento:** Movido após validação da nota (OCR ou aprovação manual do Financeiro).
7.  **Pagamento Agendado:** **(Manual V1)** Financeiro marca como agendado após lançar no banco (Ação unitária ou em massa).
8.  **Finalizado/Pago:** **(Manual V1)** Financeiro confirma o recebimento/saldo após compensação bancária (Ação unitária ou em massa).

---

## 3. Inteligência dos Jobs (Evolução e Aviso)

### Job 1: Compliance de Lançamento (Aberto -> Aguardando Líder)
*   **Regra:** Se todos os `DiaPeriodo__c` úteis possuem `DiaCompleto__c = True`.
*   **Ação:** Altera o status do **Período**. Dispara aviso de envio ao colaborador e alerta ao líder.

### Job 2: Fila Administrativa (Aguardando Líder -> Aguardando RH)
*   **Regra:** Se não existem mais logs no período com status "Em aprovação do serviço" ou "Rascunho".
*   **Ação:** Altera o status do **Período** para "Aguardando Aprovação RH". Dispara alerta ao RH/Backoffice.

### Job 3: Liberação de Faturamento (Aguardando RH -> Liberado para NF)
*   **Regra:** Se todos os logs do período estão com status "Aprovado".
*   **Ação:** Calcula o valor financeiro final e altera o status para "Liberado para NF". Dispara instrução de emissão de nota ao colaborador.

### Job 4: Follow-up e Cobrança (Ativo)
Varre o funil e "cutuca" os responsáveis:
*   **Colaborador:** Cobra preenchimento de dias em branco (período Aberto).
*   **Líder:** Alerta sobre logs parados em "Aprovação do Serviço".
*   **RH:** Alerta sobre logs parados em "Aprovação do RH".
*   **Financeiro:** Alerta sobre notas subidas e pendentes de validação.

---

## 4. Cockpit Financeiro V1 (Execução Manual)
A tela do Financeiro permitirá a gestão do lote de pagamentos:
*   **Visão de Notas:** Lista de NFs subidas com indicação de conformidade (OCR).
*   **Ações Unitárias:** Aprovar nota, Agendar Pagamento ou Confirmar Pagamento para um colaborador específico.
*   **Ações em Massa:** Selecionar múltiplos períodos e aplicar status "Agendado" ou "Pago" em lote (após operação manual no banco).

---

## 5. Roadmap Técnico V1

### Fase 1: Fundação (Imediato)
*   Deploy do campo `DiaCompleto__c` (Fórmula no DiaPeriodo).
*   Atualização do Picklist `Status__c` no objeto Periodo.
*   Criação da tela de **Gestão de Períodos (RH)**.

### Fase 2: Motor de Automação
*   Implementação dos Jobs 1, 2 e 3 de transição automática.
*   Configuração das notificações da Capivorce.

### Fase 3: Portal NF e Financeiro V1
*   Interface de upload de NF para o colaborador.
*   Tela do Financeiro para validação de notas e movimentação manual/massiva de status bancários.
