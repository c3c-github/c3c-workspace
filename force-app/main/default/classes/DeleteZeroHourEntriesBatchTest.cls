@isTest
private class DeleteZeroHourEntriesBatchTest {
    
    @testSetup
    static void setup() {
        Pessoa__c p = new Pessoa__c(Name = 'Teste', Email__c = 'teste@c3c.com');
        insert p;

        // Status__c é fórmula baseada em datas. Definimos datas para que fique "Ativo" se necessário.
        Servico__c s = new Servico__c(
            Name = 'Servico Teste', 
            DataInicio__c = Date.today().addDays(-1)
        );
        insert s;

        // Registro que DEVE ser excluído (Tudo zero)
        LancamentoHora__c l1 = new LancamentoHora__c(
            Pessoa__c = p.Id,
            Servico__c = s.Id,
            Horas__c = 0,
            HorasExtras__c = 0
        );

        // Registro que NÃO deve ser excluído (Tem horas)
        LancamentoHora__c l2 = new LancamentoHora__c(
            Pessoa__c = p.Id,
            Servico__c = s.Id,
            Horas__c = 1,
            HorasExtras__c = 0
        );

        insert new List<LancamentoHora__c>{l1, l2};
    }

    @isTest
    static void testBatch() {
        Test.startTest();
        DeleteZeroHourEntriesBatch b = new DeleteZeroHourEntriesBatch();
        Database.executeBatch(b);
        Test.stopTest();

        // Verifica se restou apenas 1
        Integer count = [SELECT COUNT() FROM LancamentoHora__c];
        System.assertEquals(1, count, 'Deveria restar apenas 1 lançamento (o que possui horas).');
    }
}