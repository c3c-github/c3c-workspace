# 📖 Manual do Usuário - C3C Workspace

**Bem-vindo ao C3C Workspace!**  
Este guia foi criado para auxiliar a unidade de **Suporte** a utilizar a nova plataforma de gestão de chamados e apontamento de horas. Aqui você encontrará o fluxo completo de trabalho, desde a captura de um ticket até o registro das atividades.

---

## 1. Primeiros Passos

### O que é o C3C Workspace?
É a plataforma centralizada onde você realizará o atendimento aos clientes e o registro de suas atividades. O sistema integra a gestão de tickets (Mesa de Operações) com o controle de horas (Timesheet), eliminando a necessidade de usar múltiplas ferramentas.

### Como Acessar
1.  Acesse o link do sistema workspace.c3csoftware.com.br.
2.  Faça login com sua conta corporativa (Microsoft/Azure).
3.  Você será direcionado ao **Painel de Eficiência**.

---

## 2. Seu Painel de Eficiência (Dashboard)

Ao entrar, o sistema apresenta um resumo do seu desempenho pessoal.

*   **Adesão / Eficiência (%):** Indica se você está cumprindo a meta de horas do período (calculada sobre dias úteis e seu contrato).
*   **Banco de Horas:** Seu saldo acumulado total.
*   **Pendências (Rascunhos):** Quantidade de horas lançadas mas **não enviadas**. Mantenha este número zerado para garantir o fechamento do seu ponto.
*   **Meus Projetos Ativos:** Lista os clientes onde você possui alocação vigente.

---

## 3. Módulo de Operações (Suporte)

Este é o seu ambiente de trabalho principal. Aqui você gerencia a fila de atendimento e registra suas atividades.

### 🔍 Encontrando Chamados
Utilize os filtros no topo da tela:
*   **Meus:** Chamados que já estão sob sua responsabilidade.
*   **Fila:** Chamados abertos ("New") aguardando atendimento nas contas que você atende.
*   **Time:** Chamados atribuídos a outros colegas da sua equipe.
*   **Busca:** Você pode pesquisar rapidamente por número do ticket, título ou nome do cliente.

### ⚙️ Ações no Chamado
Ao abrir um ticket, você tem diversas funcionalidades para gerenciar o ciclo de vida do atendimento:

1.  **Puxar (Assumir):** Se o chamado estiver na "Fila", clique para trazê-lo para sua responsabilidade.
2.  **Atualizar Dados:** No botão de edição, você pode alterar:
    *   **Status** e **Prioridade**.
    *   **Data Estimada de Entrega:** Mantenha o cliente informado sobre a previsão de solução.
3.  **Barra de Status:** Clique nos passos (New > In Progress > ...) para avançar o status rapidamente.
4.  **Transferir:** Precisa passar o bastão? Você pode transferir o ticket diretamente para outro analista ou devolvê-lo para a Fila.
5.  **Anexos:** Faça upload de múltiplos arquivos (evidências, prints) diretamente no chamado.
6.  **Comentários:** Área de comunicação. **Atenção:** Os comentários são visíveis para o cliente. Use linguagem profissional.

### ⏱️ Cronômetro Integrado (Timer)
Na barra superior, existe um **Timer Global**.
*   Selecione um chamado e clique no **"Play"**.
*   O sistema contará o tempo enquanto você trabalha.
*   Ao clicar em **"Stop"**, a tela de lançamento abrirá automaticamente com as horas já preenchidas.

### 🕒 Apontamento Manual de Horas
Se não usar o timer, você pode lançar manualmente na barra lateral direita.
1.  Clique em **"Lançar"**.
2.  O sistema seleciona automaticamente o Cliente e o Projeto.
3.  Descreva a atividade. Essa descrição compõe o relatório técnico enviado ao cliente.
4.  O sistema arredonda os tempos para frações de 30 minutos (0.5h).

---

## 4. Módulo Timesheet (Conferência)

Utilize este módulo para conferir seus apontamentos e enviá-los para aprovação.

### Validações Inteligentes
O sistema possui travas para evitar erros no seu apontamento:
*   **Dias Úteis:** Se você preencher 8h (ou seu contrato cheio), o campo de "Hora Normal" trava e libera o campo "Hora Extra".
*   **Finais de Semana/Feriados:** O campo "Hora Normal" fica bloqueado, permitindo lançar apenas "Hora Extra".
*   **Destino da Extra:** Você deve selecionar se a hora extra vai para **Banco de Horas** ou **Pagamento**.
*   **Ausências:** Ao lançar falta, selecione o tipo (Atestado/Abonada, Desconto ou Abater do Banco).

### O Calendário
*   🔵 **Azul (Lançado):** Enviado para aprovação do líder.
*   🟡 **Amarelo (Rascunho):** Salvo, mas **não enviado**.
*   🟢 **Verde (Aprovado):** Validado pelo gestor.
*   🔴 **Vermelho (Reprovado):** Devolvido para correção.

### Fechamento do Dia/Período
Para que suas horas sejam contabilizadas, você deve alterar o status de "Rascunho" para "Lançado".
1.  Verifique se lançou tudo corretamente.
2.  Clique em **"Enviar Dia"** (para fechar um dia específico) ou **"Enviar Período"**.
3.  Após o envio, o dia fica bloqueado para edição. Caso precise corrigir algo, solicite a reprovação ao seu gestor.

---

## 5. Gestão de Suporte (Líderes)

Módulo exclusivo para Coordenadores e Líderes monitorarem a operação.

*   **Visão de Time:** Acompanhe quem já lançou horas no dia e quem está com pendências.
*   **Extrato de Contrato:** Monitore o consumo de horas de cada cliente em tempo real.
*   **Gestão de Alocações:**
    *   Edite percentuais e datas de alocação da equipe.
    *   O sistema calcula o total alocado da pessoa em tempo real (ex: alerta se passar de 100%).
    *   **Importante:** A "Data Fim Original" é obrigatória para rastreabilidade.

---

## 6. Dúvidas Frequentes

**P: Posso criar um contato novo se ele não existir?**
R: Sim! No Módulo de Operações, ao criar um ticket, use o botão **"+"** ao lado do campo de contato para cadastrar um novo solicitante na hora.

**P: O cliente vê o que eu escrevo no apontamento de horas?**
R: **Sim.** A descrição da atividade ("Justificativa") e os comentários do caso são transparentes para o cliente. Escreva sempre pensando que o cliente está lendo.

**P: Por que não consigo lançar hora em um chamado?**
R: O sistema valida se você tem uma **Alocação Ativa** na conta daquele chamado na data do lançamento. Se sua alocação venceu, o sistema bloqueia o lançamento. Procure seu gestor.

**P: Posso reabrir um chamado fechado?**
R: Sim. Se o chamado estiver fechado ("Closed"), um botão "Reabrir Caso" aparecerá no topo da tela. Isso permite continuar o histórico no mesmo ticket.
