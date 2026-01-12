@isTest
private class PeriodoBatchScheduleTest {
    
    // Expressão CRON para rodar no primeiro dia de cada mês à meia-noite
    public static String CRON_EXP = '0 0 0 1 * ?';

    @isTest static void testSchedule() {
        Test.startTest();

        // Agenda o job
        String jobId = System.schedule('PeriodoBatchScheduleTest', CRON_EXP, new PeriodoBatchSchedule());

        // Recupera o Trigger para verificar se foi agendado corretamente
        CronTrigger ct = [SELECT Id, CronExpression, TimesTriggered, NextFireTime FROM CronTrigger WHERE Id = :jobId];

        // Validações
        System.assertEquals(CRON_EXP, ct.CronExpression, 'A expressão CRON deve corresponder.');
        System.assertEquals(0, ct.TimesTriggered, 'O job ainda não deve ter rodado.');

        // Opcional: Verificar se a data da próxima execução é correta (ex: próximo dia 1)
        // System.assertNotEquals(null, ct.NextFireTime);

        Test.stopTest();
        
        // Nota: O método execute() do batch não roda efetivamente dentro do Test.stopTest() 
        // quando chamado via Schedulable em contexto de teste assíncrono, 
        // mas garante a cobertura da classe Schedule.
    }
}