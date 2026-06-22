# Contexto Técnico - Integração Conta Azul <-> Salesforce

Este documento descreve a arquitetura, o fluxo de autenticação, o agendamento no Heroku e o sistema de monitoramento/logs da integração financeira entre o Conta Azul e o Salesforce.

---

## 1. Visão Geral da Integração
A integração foi desenvolvida em **Node.js** e roda em ambiente **Heroku**, utilizando a biblioteca **JSforce** para se conectar via API REST com a org do Salesforce (usando credenciais OAuth do tipo *Client Credentials* configuradas em variáveis de ambiente).

Os processos principais de negócio dividem-se em:
*   **Espelhamento**: Ingestão de Vendas (`VendaContaAzul__c`) e Parcelas (`ParcelaFinanceira__c`) do ERP Conta Azul para o Salesforce.
*   **Rateio de Receita**: Cálculo e distribuição ponderada das parcelas quitadas/pagas nos lançamentos de horas dos colaboradores (`LancamentoHora__c`) e consolidação do faturamento no objeto de Serviços (`Servico__c`).

---

## 2. Autenticação e Ciclo de Vida do Token (OAuth 2.0)
*   **Credenciais**: Armazenadas no Salesforce no registro único do objeto customizado `Configuracao__c` (`ClientId__c`, `ClientSecret__c`, `Token__c`, `Refresh_Token__c`, `Data_Expiracao__c`).
*   **Heartbeat**: Executado periodicamente via Heroku Scheduler (`npm run heartbeat` -> [scripts/refresh-token-heartbeat.js](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/scripts/refresh-token-heartbeat.js)). Ele verifica a validade do token e, se necessário, solicita um novo token usando o Refresh Token, salvando o novo par de chaves no Salesforce.
*   **Atenção (Rotação de Tokens)**: O Conta Azul utiliza rotação de Refresh Token. Se o fluxo for interrompido ou ocorrer concorrência na renovação, a autenticação quebra e exige reconfiguração manual do token de acesso no Salesforce.

---

## 3. Agendamento e Execução (Heroku)
A execução ocorre de tempos em tempos através de tarefas agendadas no Heroku (Heroku Scheduler):
1.  **Sincronização de Vendas**: `npm run sync-sales` -> [scripts/sync-ca-sales.js](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/scripts/sync-ca-sales.js). Varre as vendas da API do Conta Azul e faz a inserção/atualização das vendas e suas respectivas parcelas financeiras.
2.  **Rateio de Receita**: `npm run distribute-revenue` -> [scripts/distribute-revenue-total.js](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/scripts/distribute-revenue-total.js). Consolida a receita total paga e realiza a distribuição proporcional de receita nos lançamentos de horas de 2025+.

---

## 4. Estrutura de Logs e Auditoria (Salesforce)
Para monitoramento e solução de erros, implementamos um sistema robusto de gravação de logs diretamente na org:

*   **Objeto Customizado `LogSincronismo__c`**:
    *   `Script__c` (Texto): Nome da rotina (ex: `sync-ca-sales` ou `distribute-revenue`).
    *   `Data_Inicio__c` (DateTime): Início da execução.
    *   `Data_Fim__c` (DateTime): Conclusão da rotina.
    *   `Status__c` (Texto): Estado da rotina (`Executando`, `Sucesso`, `Erro`).
    *   `Mensagem_Erro__c` (Área de Texto Longa): Mensagem da exceção/erro em caso de falha.
    *   `Detalhes__c` (Área de Texto Longa - 131.072 caracteres): Armazena toda a saída detalhada (`console.log` e `console.error`) gerada durante o processo.
*   **Serviço de Log (`loggerService.js`)**:
    *   Localizado em [src/services/loggerService.js](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/src/services/loggerService.js).
    *   Utiliza o método `interceptConsole()` para capturar automaticamente toda a saída do console dos scripts e armazená-la em buffer para envio ao Salesforce.
    *   Garante resiliência: se a escrita do log falhar no Salesforce, a rotina não quebra e continua a execução.
    *   **Auto-Limpeza**: Toda execução bem-sucedida ou com erro limpa automaticamente do Salesforce os logs que tenham mais de 7 dias de criação (`CreatedDate < LAST_N_DAYS:7`), mantendo a base limpa.
*   **Conjunto de Permissões (Permission Set)**:
    *   [Logs_Sincronismo_Conta_Azul.permissionset-meta.xml](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/force-app/main/default/permissionsets/Logs_Sincronismo_Conta_Azul.permissionset-meta.xml): Dá acesso de leitura/escrita ao objeto `LogSincronismo__c`, aos seus campos e aos campos de log simplificado em `Configuracao__c` para o usuário executor da API.

---

## 5. Monitoramento Ativo (Dead Man's Snitch no Salesforce)
Para garantir que seremos notificados se o agendador no Heroku parar de rodar:
*   **Flow Agendado**: [Monitoramento_Sincronismo_Conta_Azul.flow-meta.xml](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/force-app/main/default/flows/Monitoramento_Sincronismo_Conta_Azul.flow-meta.xml)
*   **Comportamento**: Roda diariamente às 08:00 UTC (05:00 BRT) no Salesforce.
*   **Lógica**: Verifica se o último sucesso em `Configuracao__c` ocorreu há mais de 24 horas ou se a última execução retornou "Erro". Em caso positivo, envia um e-mail de alerta detalhado para o administrador (`tulio.sales@c3c.com.br`).
