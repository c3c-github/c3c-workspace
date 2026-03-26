@isTest
private class OrcamentoEqualizerTest {
    @testSetup
    static void setup() {
        // Criar feriado para teste de dias úteis
        insert new Holiday(Name = 'Feriado Teste', ActivityDate = Date.today().toStartOfMonth().addDays(5));

        Account acc = new Account(Name = 'Cliente Teste');
        insert acc;

        Servico__c servico = new Servico__c(
            Name = 'Serviço Teste',
            Conta__c = acc.Id,
            DataInicio__c = Date.today().toStartOfMonth(),
            DataFimOriginal__c = Date.today().toStartOfMonth().addMonths(3).addDays(-1)
        );
        insert servico;

        Estado__c est = new Estado__c(Name='São Paulo', Sigla__c = 'SP');
        insert est;
        Municipio__c mun = new Municipio__c(Name='São Paulo', Estado__c = est.Id);
        insert mun;
        Pessoa__c pessoa = new Pessoa__c(Name = 'Consultor Teste', Municipio__c = mun.Id);
        insert pessoa;
        
        Alocacao__c aloc = new Alocacao__c(
            Servico__c = servico.Id,
            Pessoa__c = pessoa.Id,
            DataInicio__c = servico.DataInicio__c,
            DataFimOriginal__c = servico.DataFimOriginal__c,
            Percentual__c = 100,
            TaxaVenda__c = 100,
            CustoHr__c = 50
        );
        insert aloc;
    }

    @isTest
    static void testEqualizeAndRecompute() {
        Alocacao__c aloc = [SELECT Id FROM Alocacao__c LIMIT 1];
        
        // 1. Criar um registro de orçamento manual para garantir que será deletado
        insert new OrcamentoCompetencia__c(
            Alocacao__c = aloc.Id,
            Competencia__c = Date.today().toStartOfMonth(),
            ReceitaPrevista__c = 9999
        );

        Test.startTest();
        OrcamentoEqualizer.equalizeAllActive();
        Test.stopTest();

        List<OrcamentoCompetencia__c> orcs = [SELECT Id, ReceitaPrevista__c, CustoPrevisto__c FROM OrcamentoCompetencia__c WHERE Alocacao__c = :aloc.Id];
        
        // Deve ter pelo menos 3 meses criados (setup cria 3 meses)
        System.assert(orcs.size() >= 3, 'Deveria ter criado registros para as competências');
        
        // Verificar se o valor de 9999 foi deletado (limpeza)
        for(OrcamentoCompetencia__c o : orcs) {
            System.assertNotEquals(9999, o.ReceitaPrevista__c, 'O registro antigo deveria ter sido deletado');
            System.assert(o.ReceitaPrevista__c > 0, 'Receita prevista deve ser calculada');
            System.assert(o.CustoPrevisto__c > 0, 'Custo previsto deve ser calculado');
        }
    }

    @isTest
    static void testSchedulableExecution() {
        Test.startTest();
        OrcamentoEqualizerSchedulable sched = new OrcamentoEqualizerSchedulable();
        sched.execute(null);
        Test.stopTest();
        
        // Verifica se pelo menos o primeiro passo (equalização) ocorreu
        List<OrcamentoCompetencia__c> orcs = [SELECT Id FROM OrcamentoCompetencia__c];
        System.assert(orcs.size() > 0, 'Deveria ter processado a equalização via Schedulable');
    }
}
