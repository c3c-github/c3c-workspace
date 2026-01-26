@isTest
private class ContaAzulSyncBatchTest {

    @testSetup
    static void setup() {
        // 1. Configuração da API
        insert new Configuracao__c(
            ClientId__c = 'client_id',
            ClientSecret__c = 'client_secret',
            Refresh_Token__c = 'refresh_token',
            Token__c = 'access_token',
            Data_Expiracao__c = Datetime.now().addHours(1)
        );

        // 2. Conta e Serviço
        Account acc = new Account(Name = 'Cliente Teste');
        insert acc;

        Servico__c servico = new Servico__c(
            Name = 'Serviço Teste',
            Conta__c = acc.Id,
            DataInicio__c = Date.today(),
            DataFimOriginal__c = Date.today().addMonths(6)
        );
        insert servico;

        // 3. Alocação Prevista (Item Comercial) - Necessário para marcar orçamento como faturável
        AlocacaoPrevista__c ap = new AlocacaoPrevista__c(
            Servico__c = servico.Id,
            Produto__c = 'Consultoria',
            TaxaVenda__c = 100,
            CustoEstimado__c = 50,
            DataInicio__c = Date.today(),
            DataFim__c = Date.today().addMonths(1),
            PercentualAlocacao__c = 100
        );
        insert ap;

        // 4. Alocação (Recurso) - Criação de vínculo para gerar orçamento
        // Criar Estado e Município (Obrigatórios para Pessoa__c)
        Estado__c est = new Estado__c(Name='São Paulo', Sigla__c = 'SP');
        insert est;

        Municipio__c mun = new Municipio__c(Name='São Paulo', Estado__c = est.Id);
        insert mun;

        Pessoa__c pessoa = new Pessoa__c(
            Name = 'Consultor Teste',
            Municipio__c = mun.Id
        );
        insert pessoa;
        
        Alocacao__c aloc = new Alocacao__c(
            Servico__c = servico.Id,
            Pessoa__c = pessoa.Id,
            AlocacaoPrevista__c = ap.Id,
            DataInicio__c = Date.today(),
            DataFimOriginal__c = Date.today().addMonths(1),
            Percentual__c = 100
        );
        insert aloc;

        // 5. Orçamento de Competência (alvo da distribuição)
        OrcamentoCompetencia__c orc = new OrcamentoCompetencia__c(
            Servico__c = servico.Id,
            Alocacao__c = aloc.Id,
            AlocacaoPrevista__c = ap.Id, // Importante: Batch filtra por isso
            Competencia__c = Date.today().toStartOfMonth(), 
            ReceitaPrevista__c = 1000,
            CustoPrevisto__c = 500
        );
        insert orc;

        // 6. Venda Conta Azul (Pai da Parcela)
        VendaContaAzul__c venda = new VendaContaAzul__c(
            Servico__c = servico.Id,
            IDContaAzul__c = 'venda-uuid',
            IDEventoFinanceiro__c = 'evento-uuid', // Necessário para o Batch pegar
            ValorTotal__c = 1000
        );
        insert venda;

        // 7. Parcela Financeira (Objeto do Batch)
        ParcelaFinanceira__c parcela = new ParcelaFinanceira__c(
            Servico__c = servico.Id,
            VendaContaAzul__c = venda.Id,
            Valor__c = 1000,
            Status__c = 'PENDENTE',
            DataVencimento__c = Date.today()
        );
        insert parcela;
    }

    @isTest
    static void testBatchExecution() {
        // Configura o Mock para responder às chamadas HTTP
        Test.setMock(HttpCalloutMock.class, new ContaAzulMock());

        Test.startTest();
        // Executa o Batch
        ContaAzulSyncBatch batch = new ContaAzulSyncBatch();
        Database.executeBatch(batch, 10);
        Test.stopTest();

        // Verificações
        
        // 1. A parcela deve ter mudado para Pago (conforme Mock)
        ParcelaFinanceira__c parcAtualizada = [SELECT Status__c FROM ParcelaFinanceira__c LIMIT 1];
        System.assertEquals('Pago', parcAtualizada.Status__c, 'O status da parcela deveria ser atualizado para Pago');

        // 2. Deve ter sido criada uma Distribuição de Receita
        List<DistribuicaoReceita__c> dists = [SELECT Id, ValorDistribuido__c FROM DistribuicaoReceita__c];
        System.assert(!dists.isEmpty(), 'Deveria ter criado uma distribuição de receita');
        System.assertEquals(1000, dists[0].ValorDistribuido__c, 'O valor distribuído deve corresponder ao valor da parcela/saldo');
    }
}