String periodId = 'a1EN50000026mNRMAY';

// 1. Abrir o período
update new Periodo__c(Id = periodId, Status__c = 'Aberto');

// 2. Mudar lançamentos para rascunho
List<LancamentoHora__c> logs = [SELECT Id FROM LancamentoHora__c WHERE DiaPeriodo__r.Periodo__c = :periodId];
for(LancamentoHora__c l : logs) {
    l.Status__c = 'Rascunho';
    l.MotivoReprovacao__c = null;
}
if(!logs.isEmpty()) update logs;

// 3. Excluir Notas Fiscais
delete [SELECT Id FROM NotaFiscal__c WHERE Periodo__c = :periodId];

// 4. Excluir Anexos (ContentDocuments)
List<ContentDocumentLink> links = [SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId = :periodId];
Set<Id> docIds = new Set<Id>();
for(ContentDocumentLink cdl : links) docIds.add(cdl.ContentDocumentId);
if(!docIds.isEmpty()) {
    delete [SELECT Id FROM ContentDocument WHERE Id IN :docIds];
}

System.debug('Resete do período do Brito concluído.');
