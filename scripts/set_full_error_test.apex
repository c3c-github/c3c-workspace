
Periodo__c p = [SELECT Id FROM Periodo__c WHERE Name = 'Fevereiro 2026 - Arthur Brito' LIMIT 1];
p.Status__c = 'Liberado para Nota Fiscal';
update p;

// 1. Reprovar algumas horas (Step 1)
List<LancamentoHora__c> logs = [SELECT Id FROM LancamentoHora__c WHERE DiaPeriodo__r.Periodo__c = :p.Id LIMIT 2];
for(LancamentoHora__c l : logs) {
    l.Status__c = 'Reprovado serviço';
    l.MotivoReprovacao__c = 'Atividade descrita de forma genérica.';
}
update logs;

// 2. Reprovar a Nota Fiscal (Step 3)
List<NotaFiscal__c> nfs = [SELECT Id FROM NotaFiscal__c WHERE Periodo__c = :p.Id AND Tipo__c = 'Entrada'];
if(nfs.isEmpty()) {
    insert new NotaFiscal__c(
        Periodo__c = p.Id,
        Tipo__c = 'Entrada',
        Status__c = 'Reprovada',
        MotivoReprovacao__c = 'CNPJ Receptor incorreto.',
        Valor__c = 1000.00
    );
} else {
    nfs[0].Status__c = 'Reprovada';
    nfs[0].MotivoReprovacao__c = 'CNPJ Receptor incorreto.';
    update nfs;
}
System.debug(' Arthur Brito configurado com ERROS no Step 1 e Step 3 para testes.');

