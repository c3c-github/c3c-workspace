String periodId = 'a1EN50000026mNRMAY';

// 1. Restaurar Notas Fiscais deletadas
List<NotaFiscal__c> deletedNFs = [SELECT Id FROM NotaFiscal__c WHERE Periodo__c = :periodId AND IsDeleted = true ALL ROWS];
if(!deletedNFs.isEmpty()) {
    undelete deletedNFs;
}

// 2. Restaurar status do período e logs
update new Periodo__c(Id = periodId, Status__c = 'Nota em Validação');

List<LancamentoHora__c> logs = [SELECT Id FROM LancamentoHora__c WHERE DiaPeriodo__r.Periodo__c = :periodId];
for(LancamentoHora__c l : logs) {
    l.Status__c = 'Aprovado';
}
if(!logs.isEmpty()) update logs;

System.debug('Dados restaurados com sucesso.');
