List<String> jobsToAbort = new List<String>{'Equalização de Orçamentos Horária', 'ContaAzul Sync Hourly', 'ApuracaoCustosSchedule Job'};
for (CronJobDetail cjd : [SELECT Id, Name FROM CronJobDetail WHERE Name IN :jobsToAbort]) {
    for (CronTrigger ct : [SELECT Id FROM CronTrigger WHERE CronJobDetailId = :cjd.Id]) {
        System.abortJob(ct.Id);
        System.debug('Removido: ' + cjd.Name);
    }
}
