# 📘 Manual Técnico - C3C Workspace

**Versão do Documento:** 1.0  
**Data:** 27/01/2026  
**Stack Tecnológica:** Node.js (v18+), Express.js, EJS (Views), TailwindCSS, Salesforce (Banco de Dados/Backend via JSforce).

---

## 1. Visão Geral da Arquitetura

O sistema segue o padrão **MVC (Model-View-Controller)**:
*   **Model:** A camada de dados reside inteiramente no Salesforce. O Node.js atua como um *proxy* inteligente, realizando consultas SOQL e operações DML via API. Não há banco de dados local (exceto sessões em memória/cookie).
*   **View:** Renderização no servidor (SSR) utilizando EJS. O Frontend utiliza TailwindCSS e JavaScript puro (Vanilla JS) para interatividade.
*   **Controller:** Lógica de negócios em arquivos JS separados por domínio (`src/controllers/`).

---

## 2. Autenticação e Segurança

### Controle de Acesso (`src/routes.js`)
*   **Middleware `requireAuth`:** Verifica se `req.session.user` existe. Caso contrário, redireciona para login.
*   **Middleware `requireGroup(role)`:** Valida se o array `user.grupos` (vindo do Salesforce/Azure) contém a *role* necessária (ex: 'GESTOR', 'OPERACAO').

### Fluxo de Login (`authController.js`)
*   Integração via **Azure AD** (OpenID Connect) ou Login direto Salesforce (fallback).
*   Ao logar, o sistema busca o registro de `Pessoa__c` no Salesforce usando o e-mail.
*   **Sessão:** Armazena ID, Nome, E-mail e Grupos de Permissão.

---

## 3. Módulo Dashboard (Perfil de Eficiência)

**Controlador:** `dashboardController.js` e `apiController.js` (`getDashboardMetrics`)

### Regras de Negócio
O Dashboard principal foca na eficiência individual do usuário logado.

1.  **Identificação do Período:** O sistema busca automaticamente o `Periodo__c` vigente (mais recente) para o usuário.
2.  **Cálculo de Dias Úteis:**
    *   Não usa cálculo matemático simples.
    *   **Query:** Realiza um `COUNT` na tabela `DiaPeriodo__c` filtrando por `Periodo__c` e `Tipo__c = 'Útil'`. Isso garante respeito a feriados cadastrados.
3.  **Cálculo de Meta (Horas Alocadas):**
    *   `Meta = Dias Úteis * Carga Horária Diária (Contrato) * % de Alocação (Soma de todas as alocações ativas)`.
4.  **Cálculo de Realizado (Horas Lançadas):**
    *   Soma de `Horas__c` + `HorasExtras__c` na tabela `LancamentoHora__c`.
5.  **Indicador de Eficiência (Adesão):**
    *   `(Horas Realizadas / Meta) * 100`.
6.  **Banco de Horas:**
    *   Exibe o saldo acumulado histórico (`SUM(HorasBanco__c)`), não apenas do período.

---

## 4. Módulo Timesheet (Apontamento de Horas)

**Controlador:** `timesheetController.js`

### Regras de Validação (`saveEntry`)
O sistema impede lançamentos que violem regras trabalhistas ou contratuais:
1.  **Bloqueio de Dia:** Verifica se o dia (`DiaPeriodo__c`) já foi "Fechado" (status diferente de Rascunho/Reprovado). Se sim, bloqueia edição.
2.  **Limite de 24h:** A soma diária não pode exceder 24 horas.
3.  **Limite Contratual:** O lançamento de horas normais não pode exceder a carga horária do contrato (ex: 8h). O excedente deve ser lançado como Extra ou Banco.
4.  **Criação Automática de Responsável:**
    *   Ao lançar hora, o sistema verifica se existe um registro de `Responsavel__c` (vínculo Atividade <-> Alocação). Se não existir, cria automaticamente.

### Workflow de Status
1.  **Rascunho:** Estado inicial. Editável pelo usuário.
2.  **Lançado:** Após o usuário clicar em "Enviar Dia/Período". Bloqueado para edição. Visível para o Gestor.
3.  **Aprovado:** Validado pelo Gestor. Pronto para faturamento.
4.  **Reprovado:** Devolvido pelo Gestor. Volta a ser editável pelo usuário para correção.

---

## 5. Módulo Operações (Service Desk)

**Controlador:** `operationsController.js`

### Visibilidade de Chamados (`getTickets`)
Diferente do Timesheet (focado no Projeto), o Operations foca no **Cliente (Conta)**.
*   **Regra de Visibilidade:** O usuário vê chamados de **todas as Contas** onde ele possui uma alocação (`Alocacao__c`) ativa na data atual (`HOJE`).
*   **Filtros:**
    *   *Meus:* Chamados atribuídos ao usuário (`Pessoa__c = User`).
    *   *Fila:* Chamados sem atribuição (`Pessoa__c = null`) das contas permitidas.
    *   *Time:* Chamados atribuídos a colegas nas contas permitidas.

### Integração Ticket x Timesheet (`saveLog`)
Permite apontar horas de dentro do chamado.
*   **Lógica de Vínculo:** O sistema faz uma busca reversa. Dado o Ticket (que pertence a uma Conta), ele busca qual `Alocacao__c` o usuário tem naquela Conta para vincular o `Servico__c` correto ao lançamento de horas.
*   **Logs de Auditoria:** Toda ação (criar, editar, comentar, lançar hora) gera um registro em `LogCaso__c` para rastreabilidade.

---

## 6. Módulo Gestão de Suporte (Command Center)

**Controlador:** `supportController.js`
**Público:** Líderes e Coordenadores (`requireGroup('GESTAO_SUPORTE')`)

### Funcionalidades Técnicas
1.  **Monitoramento de Alocações:**
    *   Cruza dados de `Alocacao__c` com `LancamentoHora__c`.
    *   Calcula o % de consumo do contrato em tempo real.
2.  **Extrato de Horas:**
    *   Gera relatório detalhado por Contrato/Serviço.
3.  **Performance do Time:**
    *   Agrega horas lançadas vs. horas contratadas por colaborador.

---

## 7. Módulo Financeiro e Aprovações

**Controladores:** `apiController.js` (Aprovações), `serviceController.js` (Financeiro)

### Aprovação em Lote
*   Permite que o gestor aprove ou reprove múltiplos lançamentos de uma vez.
*   Ao reprovar, o preenchimento do campo `MotivoReprovacao__c` é obrigatório.

### Gestão de Serviços
*   CRUD de `Servico__c`.
*   Gestão de Parcelas Financeiras (`ParcelaFinanceira__c`) e integração com vendas (`VendaContaAzul__c`).

---

## 8. Modelo de Dados Principal (Salesforce)

| Objeto Salesforce | Função no Sistema |
| :--- | :--- |
| **Pessoa__c** | Representa o Usuário/Colaborador. Contém dados de login e RH. |
| **Periodo__c** | Janela de tempo (ex: Jan/2026). Contém a referência do Contrato de Trabalho. |
| **DiaPeriodo__c** | Dias individuais dentro de um período. Define se é Útil, Feriado ou Fim de Semana. |
| **Servico__c** | O Projeto ou Contrato de Suporte vendido ao cliente. |
| **Alocacao__c** | Vínculo entre Pessoa e Serviço. Define vigência e percentual de dedicação. |
| **LancamentoHora__c** | O registro de tempo. Vincula: Pessoa, Dia, Serviço e Atividade. |
| **Case (Ticket)** | Chamados de suporte. Vinculado à Conta (Cliente). |
| **Atividade__c** | Tarefa específica dentro de um Serviço. Pode estar vinculada a um Case. |

---

### Observações Finais
*   **Performance:** Queries SOQL são otimizadas para trazer apenas campos necessários. Filtros de data são essenciais para evitar *limits* do Salesforce.
*   **Datas:** O sistema padroniza o tratamento de datas para evitar problemas de timezone (GMT-3 vs UTC).
