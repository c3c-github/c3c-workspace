# Contexto Geral - Integração e Sincronismo Conta Azul <-> Salesforce

Este documento serve como fonte de verdade técnica e operacional para qualquer desenvolvedor ou agente de IA que precise realizar manutenção, depuração ou deploy no motor de integração entre o Conta Azul e o Salesforce.

---

## 1. Ambientes, Organizações e Credenciais

### Salesforce Org (c3c)
*   **Instância / URL de Produção**: `https://c3c.my.salesforce.com` (Org ID: `00D4x0000022d9SEAQ`)
*   **Usuário de Integração / API**: `tulio.sales@c3c.com.br`
*   **Método de Conexão**: O servidor Node.js autentica-se utilizando o fluxo **OAuth 2.0 Client Credentials** (autenticação server-to-server segura via Client ID e Client Secret), sem necessidade de login interativo ou usuário/senha de integração.
*   **Alias Local na CLI (sf)**: `c3c` (mapeado para `tulio.sales@c3c.com.br`)

### Heroku App (c3c-workspace-app)
*   **Nome da Aplicação**: `c3c-workspace-app`
*   **URL da Aplicação**: `https://c3c-workspace-app-7de7cd7f7af6.herokuapp.com/`
*   **Repositório Git de Deploy (Heroku)**: `https://git.heroku.com/c3c-workspace-app.git` (Remote: `heroku`)
*   **Engine**: Node.js (v18.x) rodando em stack Heroku-24.

---

## 2. Processos de Negócio e Lógica dos Scripts (Heroku)

### A. Renovação de Sessão (Heartbeat)
*   **Script**: [scripts/refresh-token-heartbeat.js](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/scripts/refresh-token-heartbeat.js)
*   **Agendamento**: Executado a cada hora (via Heroku Scheduler).
*   **Lógica**:
    1.  Consulta o registro único no objeto customizado `Configuracao__c` no Salesforce para obter as chaves de integração.
    2.  Verifica a data de expiração (`Data_Expiracao__c`) do token atual.
    3.  Se o token expirar nos próximos 5 minutos (ou já estiver expirado), faz um POST para o serviço de autenticação do Conta Azul (`https://auth.contaazul.com/oauth2/token`), utilizando o `Refresh_Token__c` persistido.
    4.  Grava o novo `Token__c`, o novo `Refresh_Token__c` (o Conta Azul utiliza rotação de Refresh Token) e recalcula a nova data de expiração de volta no registro de `Configuracao__c` do Salesforce.

### B. Ingestão e Sincronização de Vendas (Espelho CA)
*   **Script**: [scripts/sync-ca-sales.js](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/scripts/sync-ca-sales.js)
*   **Agendamento**: Executado diariamente (ou sob demanda).
*   **Lógica**:
    1.  Obtém um token de acesso válido chamando o fluxo de autenticação.
    2.  Consulta de forma paginada (até 100 páginas de 100 itens) todas as vendas cadastradas no Conta Azul (`/v1/venda/busca?...`).
    3.  Mapeia e faz o **upsert bulk** (em blocos de 100) no Salesforce no objeto `VendaContaAzul__c`, mapeando campos de status, cliente, valor e data de emissão, utilizando o campo `IDContaAzul__c` como chave externa de ID único do Conta Azul.
    4.  Para cada venda processada, faz uma chamada à API do Conta Azul para pegar os detalhes da venda (`/v1/venda/{id}`) e identificar o ID do evento financeiro (`evento_financeiro.id`).
    5.  Se houver evento financeiro, faz uma chamada GET para buscar todas as parcelas associadas àquele evento (`/v1/financeiro/eventos-financeiros/{eventId}/parcelas`).
    6.  Mapeia e realiza o upsert no Salesforce no objeto `ParcelaFinanceira__c`, associando cada parcela ao registro pai da venda por meio do relacionamento e gravando o status de pagamento original (ex: `QUITADO` ou `EM_ABERTO`).

### C. Motor de Rateio Ponderado de Receita (Financeiro)
*   **Script**: [scripts/distribute-revenue-total.js](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/scripts/distribute-revenue-total.js)
*   **Agendamento**: Executado de forma programada pós-sincronismo.
*   **Lógica**:
    1.  **Reset**: Varre os lançamentos de horas (`LancamentoHora__c`) a partir de `2025-01-01` e reseta o campo `ValorReceita__c` de todos eles para 0.
    2.  **Mapeamento de Vendas e Serviços**: Consulta o objeto de junção `VendaServico__c` para entender quais vendas (`VendaContaAzul__c`) pertencem a quais projetos/serviços (`Servico__c`).
    3.  **Consolidação de Receita Realizada**: Consulta as parcelas financeiras (`ParcelaFinanceira__c`) com status `Pago`, `Liquidado`, `QUITADO` ou `PAGO` e soma o valor das parcelas quitadas agrupado por venda.
    4.  **Distribuição Ponderada por Lançamentos**:
        *   Para cada venda, agrupa todos os lançamentos de horas de todos os serviços atrelados a ela.
        *   Soma o total de horas gastas.
        *   Se houver horas: calcula a taxa média horária recebida (`avgRate = ReceitaPagaTotal / TotalHoras`). Aplica a receita a cada lançamento multiplicando a taxa pelas horas gastas (`ValorReceita__c = avgRate * horas`), acumulando o valor se um mesmo lançamento pertencer a múltiplos fluxos de faturamento.
        *   Se não houver horas lançadas para a venda: divide a receita igualmente entre os serviços associados na junção, lançando como "receita virtual" direto nos totais do serviço.
    5.  **Gravação e Atualização de Serviços**: Faz o update dos lançamentos no Salesforce via DML em blocos (chunks) de 200. Ao final, soma a receita realizada total de cada serviço (logs + virtual) e atualiza o campo `ReceitaRealizada__c` no registro de `Servico__c`, recalculando também a margem realizada final do projeto.

---

## 3. Arquitetura de Logs, Auditoria e Alertas

### Registro Detalhado de Execução
Implementamos a classe `IntegrationLogger` em [src/services/loggerService.js](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/src/services/loggerService.js) que automatiza os logs da aplicação:
*   **Interceptação de Console**: O método `interceptConsole()` redireciona automaticamente toda a saída de `console.log` e `console.error` gerada pelos scripts para um buffer interno de strings, sem quebrar a saída padrão (stdout/stderr).
*   **Ciclo de Vida do Log**:
    *   No início do script, cria um registro de `LogSincronismo__c` no Salesforce com `Status__c = 'Executando'` e grava a data de início.
    *   No fim do script (sucesso ou erro), atualiza o mesmo registro com `Status__c` ("Sucesso" ou "Erro"), a data de encerramento, a mensagem detalhada do erro (se houver) e grava os logs inteiros acumulados no console no campo longo `Detalhes__c`.
*   **Limpeza Automática (7 Dias)**: Para evitar acúmulo de dados na org do Salesforce, toda execução bem-sucedida ou com erro limpa automaticamente logs que tenham mais de 7 dias de criação (`CreatedDate < LAST_N_DAYS:7`) usando exclusão DML em blocos de 200.

### Controle de Permissões
Criamos e implantamos o Permission Set [Logs_Sincronismo_Conta_Azul.permissionset-meta.xml](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/force-app/main/default/permissionsets/Logs_Sincronismo_Conta_Azul.permissionset-meta.xml) que concede as permissões de leitura/escrita e edição de campos para o objeto `LogSincronismo__c` e campos adicionais de status em `Configuracao__c`. Esse Permission Set já está atribuído ao usuário `tulio.sales@c3c.com.br` na org de produção.

### Monitoramento por Fluxo Agendado (Dead Man's Snitch)
*   **Flow**: [Monitoramento_Sincronismo_Conta_Azul](file:///Users/tuliosales/Library/CloudStorage/GoogleDrive-sales.tulio@gmail.com/Outros%20computadores/Meu%20MacBook%20Air/Documents/c3c-workspace/force-app/main/default/flows/Monitoramento_Sincronismo_Conta_Azul.flow-meta.xml)
*   **Frequência**: Roda diariamente na org do Salesforce.
*   **Função**: Se a data do último sincronismo com sucesso (`Data_Ultimo_Sincronismo__c` em `Configuracao__c`) estiver atrasada mais de 24 horas, ou se o status da última tentativa for gravado como "Erro", o Salesforce envia de forma nativa um e-mail de alerta para o administrador (`tulio.sales@c3c.com.br`) informando a falha e a causa.

---

## 4. Guia de Manutenção e Comandos do Agente

Para qualquer manutenção futura ou deploy, os seguintes comandos devem ser utilizados a partir do diretório raiz do workspace:

### A. Autenticação na CLI do Salesforce (sf)
Caso a sessão da CLI perca a conexão e precise ser restabelecida, a autenticação pode ser refeita programaticamente usando o token de Client Credentials da org rodando o script utilitário:
```bash
# Executa a autenticação automática do CLI usando as credenciais do .env
node scripts/login-c3c.js
```
*Este script recupera o token atual do Salesforce de forma dinâmica e roda `sf org login access-token` associando-o ao alias `c3c`.*

### B. Como Fazer Deploy de Metadados
Para evitar falhas de deploy devido a validações de relacionamentos Master-Detail incompletas em outros arquivos do repositório, **NUNCA** faça deploy de todo o diretório local (`sf project deploy start` completo). Sempre faça de forma direcionada especificando as pastas ou metadados de interesse:

```bash
# Deploy específico de campos modificados na Configuracao__c e do Flow de Alerta
sf project deploy start --metadata CustomField:Configuracao__c.Data_Ultimo_Sincronismo__c CustomField:Configuracao__c.Status_Ultimo_Sincronismo__c CustomField:Configuracao__c.Mensagem_Erro_Sincronismo__c Flow:Monitoramento_Sincronismo_Conta_Azul --target-org c3c

# Deploy específico do objeto de Logs e seus campos
sf project deploy start --metadata CustomObject:LogSincronismo__c --target-org c3c

# Deploy específico de conjuntos de permissão
sf project deploy start --metadata PermissionSet:Logs_Sincronismo_Conta_Azul --target-org c3c
```

### C. Como Atribuir Permission Set via CLI
```bash
sf org assign permset --name Logs_Sincronismo_Conta_Azul --target-org c3c
```

### D. Como Atualizar o Heroku e GitHub (Push)
Após realizar qualquer alteração no código Node.js, comite localmente no Git e faça o push para ambas as origens (GitHub para controle de versão e Heroku para subir as alterações em produção):
```bash
git add .
git commit -m "feat: sua mensagem de alteração"

# Atualizar o repositório de controle de código no GitHub
git push origin main

# Implantar a alteração e iniciar o build em produção no Heroku
git push heroku main
```

### E. Como Executar e Testar os Scripts Remotamente no Heroku
Você pode testar a execução e validar os logs em tempo real disparando tarefas descartáveis (one-off dynos) diretamente na infraestrutura do Heroku:
```bash
# Rodar manualmente a sincronização de vendas/parcelas
heroku run "npm run sync-sales" --app c3c-workspace-app

# Rodar manualmente a redistribuição ponderada de receitas
heroku run "npm run distribute-revenue" --app c3c-workspace-app
```
*Ao executar estes comandos, verifique no console a saída e depois vá ao Salesforce na aba de "Logs de Sincronismo" para confirmar se o log correspondente foi inserido/concluído.*
