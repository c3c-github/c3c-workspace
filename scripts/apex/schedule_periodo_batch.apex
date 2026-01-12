// Agendamento para todo dia 1 às 06:00
String cronExp = '0 0 6 1 * ?';
String jobName = 'Agendamento Mensal PeriodoBatchSchedule 06:00';
System.schedule(jobName, cronExp, new PeriodoBatchSchedule());
