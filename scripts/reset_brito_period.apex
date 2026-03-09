Id periodId = 'a1EN50000026mNRMAY';

// 1. Resetar Período para Aberto
Periodo__c p = [SELECT Id FROM Periodo__c WHERE Id = :periodId];
p.Status__c = 'Aberto';
update p;

// 2. Resetar Lançamentos para Rascunho
List<LancamentoHora__c> logs = [SELECT Id, Status__c FROM LancamentoHora__c WHERE DiaPeriodo__r.Periodo__c = :periodId];
for(LancamentoHora__c l : logs) {
    l.Status__c = 'Rascunho';
}
update logs;

// 3. Remover Nota Fiscal e Arquivos vinculados
// Buscamos as NFs vinculadas a este período
List<NotaFiscal__c> nfs = [SELECT Id FROM NotaFiscal__c WHERE Periodo__c = :periodId];
if(!nfs.isEmpty()) {
    Set<Id> nfIds = new Map<Id, NotaFiscal__c>(nfs).keySet();
    
    // Localiza e remove os arquivos (ContentDocuments)
    List<ContentDocumentLink> links = [SELECT ContentDocumentId FROM ContentDocumentLink WHERE LinkedEntityId IN :nfIds];
    Set<Id> docIds = new Set<Id>();
    for(ContentDocumentLink link : links) docIds.add(link.ContentDocumentId);
    
    if(!docIds.isEmpty()) {
        List<ContentDocument> docs = [SELECT Id FROM ContentDocument WHERE Id IN :docIds];
        delete docs;
    }
    
    // Deleta os registros de Nota Fiscal
    delete nfs;
}

System.debug('Reset do Arthur Brito (Fev/2026) concluído com sucesso!');
