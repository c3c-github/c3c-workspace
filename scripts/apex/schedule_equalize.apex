// Agenda a equalização de orçamentos para rodar de hora em hora
String jobName = 'Equalização de Orçamentos Horária';
String cronExp = '0 0 * * * ?'; 

// Verifica se já existe um job com esse nome e cancela se necessário para reagendar
List<CronJobDetail> existing = [SELECT Id FROM CronJobDetail WHERE Name = :jobName];
if (!existing.isEmpty()) {
    List<CronTrigger> ct = [SELECT Id FROM CronTrigger WHERE CronJobDetailId = :existing[0].Id];
    if (!ct.isEmpty()) System.abortJob(ct[0].Id);
}

System.schedule(jobName, cronExp, new OrcamentoEqualizerSchedulable());
System.debug('✅ Job de Equalização de Orçamentos agendado para rodar de hora em hora.');
