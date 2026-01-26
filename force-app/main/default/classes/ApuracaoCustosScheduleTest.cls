@isTest
private class ApuracaoCustosScheduleTest {
    
    @isTest
    static void testSchedule() {
        Test.startTest();
        String cronExp = '0 0 0 15 3 ? 2099'; // Data futura
        String jobId = System.schedule('Test Apuracao Schedule', cronExp, new ApuracaoCustosSchedule());
        Test.stopTest();
        
        // Verifica se o job foi agendado
        CronTrigger ct = [SELECT Id, CronExpression, TimesTriggered, NextFireTime FROM CronTrigger WHERE Id = :jobId];
        System.assertEquals(cronExp, ct.CronExpression);
        System.assertEquals(0, ct.TimesTriggered);
    }
}