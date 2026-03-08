
Periodo__c p = [SELECT Id FROM Periodo__c WHERE Name = 'Fevereiro 2026 - Arthur Brito' LIMIT 1];
p.Status__c = 'Aberto';
update p;

List<LancamentoHora__c> logs = [SELECT Id FROM LancamentoHora__c WHERE DiaPeriodo__r.Periodo__c = :p.Id];
for(LancamentoHora__c l : logs) {
    l.Status__c = 'Rascunho';
    l.MotivoReprovacao__c = null;
}
update logs;

List<NotaFiscal__c> nfs = [SELECT Id FROM NotaFiscal__c WHERE Periodo__c = :p.Id];
delete nfs;

System.debug('Reset completo para Arthur Brito realizado com sucesso.');

