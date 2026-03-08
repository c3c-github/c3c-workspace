
Periodo__c p = [SELECT Id FROM Periodo__c WHERE Name = 'Fevereiro 2026 - Arthur Brito' LIMIT 1];
p.Status__c = 'Liberado para Nota Fiscal';
update p;

List<NotaFiscal__c> nfs = [SELECT Id FROM NotaFiscal__c WHERE Periodo__c = :p.Id AND Tipo__c = 'Entrada'];
if(nfs.isEmpty()) {
    insert new NotaFiscal__c(
        Periodo__c = p.Id,
        Tipo__c = 'Entrada',
        Status__c = 'Reprovada',
        MotivoReprovacao__c = 'O CNPJ do Receptor não é o da C3C. Por favor, verifique.',
        Valor__c = 1500.00
    );
} else {
    nfs[0].Status__c = 'Reprovada';
    nfs[0].MotivoReprovacao__c = 'O CNPJ do Receptor não é o da C3C. Por favor, verifique.';
    update nfs;
}
System.debug(' Arthur Brito colocado em estado de REPROVAÇÃO para testes.');

